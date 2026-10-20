// Renders an Apni Dukan order as a 58mm (384 dot) bitmap and converts it to ESC/POS raster bytes.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { FONT_B64 } from './fonts.mjs';

export const W = 384;            // 58mm printer = 384 dots
const PAD = 6;
const CW = W - PAD * 2;
const FAMILY = 'NotoGu';
const SHOP_NAME = 'અપની દુકાન';
const SHOP_SITE = 'apnidukanse.in';
const BAND = 64;                 // rows per raster command

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  GlobalFonts.register(Buffer.from(FONT_B64, 'base64'), FAMILY);
  fontReady = true;
}

const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

function fmtDate(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return { date: '', time: '' };
  return {
    date: d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }),
    time: d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase(),
  };
}

function paint(ctx, o, num) {
  let y = 10;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  const setFont = (s) => { ctx.font = `${s}px ${FAMILY}`; };

  function put(str, x, yb, size, bold, align) {
    setFont(size);
    ctx.textAlign = align || 'left';
    ctx.fillText(str, x, yb);
    if (bold) ctx.fillText(str, x + 1, yb);
  }

  function wrap(str, size, maxW) {
    setFont(size);
    const out = [];
    for (const para of String(str ?? '').split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width <= maxW) { cur = t; continue; }
        if (cur) out.push(cur);
        if (ctx.measureText(w).width <= maxW) { cur = w; continue; }
        let piece = '';
        for (const ch of Array.from(w)) {
          if (ctx.measureText(piece + ch).width > maxW) { out.push(piece); piece = ch; } else piece += ch;
        }
        cur = piece;
      }
      if (cur) out.push(cur);
    }
    return out;
  }

  const lineH = (s) => Math.round(s * 1.5);
  const base = (s) => y + Math.round(s * 1.12);

  function dash() {
    y += 5;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    ctx.restore();
    y += 9;
  }
  function center(str, size, bold) {
    for (const l of wrap(str, size, CW)) { put(l, W / 2, base(size), size, bold, 'center'); y += lineH(size); }
  }
  function row(left, right, size, bold, indent) {
    indent = indent || 0;
    setFont(size);
    const rw = Math.ceil(ctx.measureText(right).width);
    const lines = wrap(left, size, CW - rw - 12 - indent);
    lines.forEach((l, i) => {
      put(l, PAD + indent, base(size), size, bold, 'left');
      if (i === 0) put(right, W - PAD, base(size), size, bold, 'right');
      y += lineH(size);
    });
  }
  function labelValue(label, value, size) {
    const lines = wrap(`${label} ${value}`, size, CW);
    lines.forEach((l, i) => {
      put(l, PAD, base(size), size, false, 'left');
      if (i === 0) put(label, PAD, base(size), size, true, 'left');
      y += lineH(size);
    });
  }

  const B = 23, S = 20;
  const c = o.customer || {};
  const dt = fmtDate(o.createdAt);
  const gst = o.billOption === 'with-bill';

  center(SHOP_NAME, 36, true);
  center(SHOP_SITE, S, false);
  dash();
  row(`ઓર્ડર #${num}`, dt.date, B, true);
  row(`સમય: ${dt.time}`, gst ? 'GST બિલ' : 'ડાયરેક્ટ ઓર્ડર', S, false);
  dash();
  labelValue('નામ:', c.name || '', B);
  labelValue('ફોન:', c.phone || '', B);
  labelValue('સરનામું:', c.address || '', B);
  labelValue('પિનકોડ:', c.pincode || '', B);
  if (gst && o.gstNumber) labelValue('GST નં:', o.gstNumber, B);
  dash();
  for (const it of (o.items || [])) {
    for (const l of wrap(it.name || '', B, CW)) { put(l, PAD, base(B), B, true, 'left'); y += lineH(B); }
    row(`${it.qty} × ${rs(it.price)}`, rs((it.qty || 0) * (it.price || 0)), B, false, 12);
    y += 4;
  }
  dash();
  row('સબ ટોટલ', rs(o.subtotal), B, false);
  row('ડિલિવરી ચાર્જ', o.deliveryFee ? rs(o.deliveryFee) : 'મફત', B, false);
  if (gst) row('GST 18%', rs(o.gstAmount), B, false);
  dash();
  row('કુલ', rs(o.total), 30, true);
  dash();
  for (const l of wrap(`ચુકવણી: ${o.payment || ''}`, B, CW)) { put(l, PAD, base(B), B, false, 'left'); y += lineH(B); }
  dash();
  center('આભાર! ફરી પધારજો', B, true);
  return y + 40;   // extra blank paper at the bottom
}

export function renderBill(order, orderNumber) {
  ensureFont();
  const dummy = createCanvas(W, 4000);
  const h = Math.min(4000, Math.ceil(paint(dummy.getContext('2d'), order, orderNumber)));
  const canvas = createCanvas(W, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, h);
  paint(ctx, order, orderNumber);
  return canvas;
}

// Canvas -> ESC/POS bytes (init + GS v 0 raster bands + feed)
export function toEscPos(canvas) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const bpr = w / 8;
  const parts = [Buffer.from([0x1B, 0x40])];
  for (let y0 = 0; y0 < h; y0 += BAND) {
    const rows = Math.min(BAND, h - y0);
    const buf = Buffer.alloc(8 + rows * bpr);
    buf.set([0x1D, 0x76, 0x30, 0x00, bpr & 255, bpr >> 8, rows & 255, rows >> 8], 0);
    for (let r = 0; r < rows; r++) {
      for (let bx = 0; bx < bpr; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const i = ((y0 + r) * w + bx * 8 + bit) * 4;
          const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          if (lum < 150) byte |= 0x80 >> bit;
        }
        buf[8 + r * bpr + bx] = byte;
      }
    }
    parts.push(buf);
  }
  parts.push(Buffer.from([0x1B, 0x64, 0x04]));
  return Buffer.concat(parts);
}

export const SAMPLE_ORDER = {
  id: 'sample',
  items: [
    { name: 'Hex Bolt (Size: 10mm)', price: 99, qty: 2 },
    { name: 'Nut (Size: 8mm)', price: 99, qty: 1 },
  ],
  subtotal: 297,
  deliveryFee: 49,
  billOption: 'no-bill',
  gstAmount: 0,
  total: 346,
  customer: { name: 'રમેશ પટેલ', phone: '9876543210', address: '12, શિવ સોસાયટી, નરોડા, અમદાવાદ', pincode: '382330' },
  payment: 'કેશ ઓન ડિલિવરી',
  createdAt: new Date().toISOString(),
};
