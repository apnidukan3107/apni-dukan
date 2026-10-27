// Renders an Apni Dukan order as a 58mm (384 dot) bitmap and converts it to ESC/POS raster bytes.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { FONT_B64 } from './fonts.mjs';
import { partyOf } from './parties.mjs';

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
  // selling party: one line at the top if every item has the same party, otherwise a line under each item
  const items = o.items || [];
  const parties = items.map((it) => partyOf(it));
  const known = parties.filter(Boolean);
  const onePartyForAll = known.length > 0 && known.length === parties.length && known.every((x) => x === known[0]);
  if (onePartyForAll) {
    dash();
    center('સેલિંગ પાર્ટી', S, false);
    center(known[0], 30, true);
  }
  dash();
  labelValue('નામ:', c.name || '', B);
  labelValue('ફોન:', c.phone || '', B);
  labelValue('સરનામું:', c.address || '', B);
  labelValue('પિનકોડ:', c.pincode || '', B);
  if (gst && o.gstNumber) labelValue('GST નં:', o.gstNumber, B);
  dash();
  items.forEach((it, idx) => {
    for (const l of wrap(it.name || '', B, CW)) { put(l, PAD, base(B), B, true, 'left'); y += lineH(B); }
    if (!onePartyForAll && parties[idx]) {
      for (const l of wrap(`સેલિંગ પાર્ટી: ${parties[idx]}`, S, CW - 12)) { put(l, PAD + 12, base(S), S, false, 'left'); y += lineH(S); }
    }
    row(`${it.qty} × ${rs(it.price)}`, rs((it.qty || 0) * (it.price || 0)), B, false, 12);
    y += 4;
  });
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
    { name: 'Ecodrive V-Belt A16', price: 79, qty: 2 },
    { name: 'Ecodrive V-Belt A18', price: 93, qty: 1 },
  ],
  subtotal: 251,
  deliveryFee: 49,
  billOption: 'no-bill',
  gstAmount: 0,
  total: 300,
  customer: { name: 'રમેશ પટેલ', phone: '9876543210', address: '12, શિવ સોસાયટી, નરોડા, અમદાવાદ', pincode: '382330' },
  payment: 'કેશ ઓન ડિલિવરી',
  createdAt: new Date().toISOString(),
};


// ---------------------------------------------------------------------------
// Job application / seller registration slips (same 58mm bitmap, English labels)
// item = { kind: 'job' | 'sel', no, t (ms), ...fields }
// ---------------------------------------------------------------------------
function paintSlip(ctx, it) {
  let y = 10;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  const setFont = (s) => { ctx.font = `${s}px ${FAMILY}`; };
  const str = (v) => String(v == null ? '' : v).trim();

  function put(text, x, yb, size, bold, align) {
    setFont(size);
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, yb);
    if (bold) ctx.fillText(text, x + 1, yb);
  }
  function wrap(text, size, maxW) {
    setFont(size);
    const out = [];
    for (const para of String(text ?? '').split(/\r?\n/)) {
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
  function center(text, size, bold) {
    for (const l of wrap(text, size, CW)) { put(l, W / 2, base(size), size, bold, 'center'); y += lineH(size); }
  }
  function labelValue(label, value, size) {
    const lines = wrap(`${label} ${value}`, size, CW);
    lines.forEach((l, i) => {
      put(l, PAD, base(size), size, false, 'left');
      if (i === 0) put(label, PAD, base(size), size, true, 'left');
      y += lineH(size);
    });
  }
  // label followed by a line to write on (extra height so there is room for handwriting)
  function writeLine(label, size) {
    let x0 = PAD;
    if (label) {
      put(label, PAD, base(size), size, true, 'left');
      setFont(size);
      x0 = PAD + Math.ceil(ctx.measureText(label).width) + 8;
    }
    ctx.fillRect(x0, base(size) + 4, W - PAD - x0, 2);
    y += Math.round(size * 2.1);
  }

  const B = 23, S = 20;
  const isJob = it.kind === 'job';
  const when = fmtDate(new Date(Number(it.t) || Date.now()).toISOString());

  center(SHOP_NAME, 36, true);
  center(SHOP_SITE, S, false);
  dash();
  center(isJob ? 'JOB APPLICATION' : 'SELLER REGISTRATION', 28, true);
  dash();
  if (isJob) {
    labelValue('Job :', str(it.job).toUpperCase(), B);
    labelValue('App No :', it.no ? `JA-${it.no}` : 'JA-?', B);
  } else {
    labelValue('Reg No :', it.no ? `SR-${it.no}` : 'SR-?', B);
  }
  labelValue('Date :', `${when.date}  ${when.time}`, B);
  dash();
  if (isJob) {
    labelValue('Name :', str(it.name), B);
    labelValue('Mobile :', str(it.phone), B);
    labelValue('Qualif. :', str(it.qualification), B);
    labelValue('Exp. :', str(it.experience), B);
    dash();
    labelValue('Status :', 'NEW', B);
  } else {
    labelValue('Shop :', str(it.shop), B);
    labelValue('Owner :', str(it.owner), B);
    labelValue('Mobile :', str(it.mobile), B);
    labelValue('Category :', str(it.category), B);
    if (str(it.area)) labelValue('Area :', str(it.area), B);
    dash();
    labelValue('Status :', 'PENDING APPROVAL', B);
  }
  dash();
  if (isJob) writeLine('Interview Date: ___/___/____', B);
  writeLine('Remark:', B);
  writeLine('', B);
  dash();
  writeLine(isJob ? 'HR Sign:' : 'Admin Sign:', B);
  dash();
  center(isJob ? 'Thank you for applying!' : 'Approve from Admin Panel', B, true);
  center(SHOP_SITE, S, false);
  return y + 40;
}

export function renderSlip(item) {
  ensureFont();
  const dummy = createCanvas(W, 4000);
  const h = Math.min(4000, Math.ceil(paintSlip(dummy.getContext('2d'), item)));
  const canvas = createCanvas(W, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, h);
  paintSlip(ctx, item);
  return canvas;
}

export const SAMPLE_JOB = {
  kind: 'job', no: 1027, job: 'Sales Officer', name: 'Rajesh Patel',
  phone: '9876543210', qualification: 'Graduate', experience: '1-3 Years',
};
export const SAMPLE_SEL = {
  kind: 'sel', no: 1, shop: 'Ramesh Traders', owner: 'Ramesh Patel',
  mobile: '9876543210', category: 'Hardware', area: 'Naroda, Ahmedabad',
};
