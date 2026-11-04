// POST /api/po-extract   body: { sellerId, pin, mime, data }   (data = base64 of a PDF or a photo)
// Reads a purchase order with Claude and returns the few fields needed for the thermal slip.
// Needs the Vercel environment variable ANTHROPIC_API_KEY (an Anthropic API key, separate from the Claude app).
// Optional env variables: PO_MODEL (default claude-sonnet-5-5), PO_DAILY_LIMIT (default 30 reads per day).
// Protection: only the allowed sellers, and only with their correct PIN, so strangers cannot use the paid API.
import { getDb } from './_lib/firebase.mjs';

export const config = { maxDuration: 60 };

const ALLOWED_SELLERS = ['sel-sandhya'];
const MODEL = process.env.PO_MODEL || 'claude-sonnet-5-5';
const DAILY_LIMIT = Number(process.env.PO_DAILY_LIMIT || 30);
const MAX_B64_CHARS = 4000000;
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const PROMPT = `This is a purchase order (PO) sent to a supplier. Read it carefully and return ONLY one JSON object, with no other text, in exactly this shape:
{
  "poNo": "PO number as printed",
  "poDate": "PO date as DD/MM/YYYY",
  "billTo": "name of the company in the 'Bill To' section only (no address)",
  "supplier": "supplier name",
  "paymentTerms": "payment terms in a short phrase, or empty",
  "docTotal": the final total amount printed on the PO as a number, or null if it is not shown,
  "items": [
    { "code": "item code", "name": "product description without the code", "hsn": "HSN code or empty",
      "qty": number, "unit": "PC / NOS / KG ...", "rate": number (unit rate),
      "gstPct": number (CGST% + SGST%, or IGST% if that is used), "deliveryDate": "DD/MM/YYYY or empty" }
  ],
  "notes": "anything unclear or unreadable, or empty"
}
Rules: copy the numbers exactly as printed, do not calculate or guess. If a discount is non-zero, set rate to the net unit rate and mention it in notes. Include every item row. Use plain numbers (no currency symbols or commas).`;

function num(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function txt(v, max = 200) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function parseJson(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json');
  return JSON.parse(text.slice(a, b + 1));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel' });
  try {
    const { sellerId, pin, mime, data } = req.body || {};
    if (!ALLOWED_SELLERS.includes(sellerId)) return res.status(403).json({ error: 'not allowed' });
    if (!ALLOWED_MIME.includes(mime)) return res.status(400).json({ error: 'only PDF or photo' });
    if (typeof data !== 'string' || data.length < 100 || data.length > MAX_B64_CHARS) {
      return res.status(400).json({ error: 'file too big (use under 3 MB)' });
    }

    const db = getDb();
    // 1) the seller's PIN must be correct
    const sSnap = await db.collection('store').doc('sellers').get();
    let sellers = [];
    try { sellers = JSON.parse(sSnap.data().value) || []; } catch { sellers = []; }
    const seller = sellers.find((s) => s && s.id === sellerId);
    if (!seller || String(seller.pin) !== String(pin)) return res.status(401).json({ error: 'wrong pin' });

    // 2) daily limit (protects the API bill)
    const day = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const useRef = db.collection('store').doc('poExtractUsage');
    const useSnap = await useRef.get();
    const used = useSnap.exists && useSnap.data().day === day ? Number(useSnap.data().count) || 0 : 0;
    if (used >= DAILY_LIMIT) return res.status(429).json({ error: 'daily limit reached' });
    await useRef.set({ day, count: used + 1 });

    // 3) ask Claude to read the document
    const docBlock = mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mime, data } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data } };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        messages: [{ role: 'user', content: [docBlock, { type: 'text', text: PROMPT }] }],
      }),
    });
    if (!r.ok) {
      console.error('po-extract AI error', r.status, (await r.text()).slice(0, 300));
      return res.status(502).json({ error: `AI error ${r.status}` });
    }
    const j = await r.json();
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const raw = parseJson(text);

    const po = {
      poNo: txt(raw.poNo, 40),
      poDate: txt(raw.poDate, 20),
      billTo: txt(raw.billTo, 120),
      supplier: txt(raw.supplier, 120),
      paymentTerms: txt(raw.paymentTerms, 120),
      docTotal: raw.docTotal == null || raw.docTotal === '' ? null : num(raw.docTotal),
      notes: txt(raw.notes, 300),
      items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 40).map((x) => ({
        code: txt(x.code, 40),
        name: txt(x.name, 120),
        hsn: txt(x.hsn, 20),
        qty: num(x.qty),
        unit: txt(x.unit, 10) || 'PC',
        rate: num(x.rate),
        gstPct: num(x.gstPct),
        deliveryDate: txt(x.deliveryDate, 20),
      })),
    };
    if (!po.items.length) return res.status(422).json({ error: 'no items found' });
    return res.status(200).json({ ok: true, po });
  } catch (e) {
    console.error('po-extract failed', e);
    return res.status(500).json({ error: 'could not read the PO' });
  }
}
