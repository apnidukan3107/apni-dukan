// One endpoint for the ESP32 printer:
//   GET /api/print?action=next            -> {id, orderNumber} or {none:true}
//   GET /api/print?action=job&id=ORDERID  -> ESC/POS bytes (bill as image)
//   GET /api/print?action=done&id=ORDERID -> marks as printed
//   GET /api/print?action=test            -> queues one sample bill (to test the printer)
//   GET /api/print?action=reprint&n=70    -> prints admin order number 70 once more
//   GET /api/print?action=statuspage      -> status page (open in the phone browser, add ?key=...)
//   action=status | check | pcheck | fail  -> used by the status page and the ESP32
//   GET /api/print?action=preview&id=ORDERID  (or id=sample) -> PNG preview in the browser
//   Job application / seller registration slips: queued by the app in printState.queue (ids ja_... / sr_... / po_...),
//   preview with id=sample_job or id=sample_sel. They print in the same line as orders, oldest first.
// Auth: header "x-print-key" (or ?key=).
//   PRINT_KEY          -> main printer (Apni Dukan): prints EVERY order, plus job/seller/PO slips (unchanged behaviour)
//   PRINT_KEY_LAXMAN   -> Laxman Mobile Shop printer: only orders that contain Laxman's items, bill shows only his items + his total
//   PRINT_KEY_AARTI    -> Aarti's Selection printer: same for Aarti's items
//   Each printer keeps its own "printed" list in its own Firestore doc, so one printer never hides an order from another.
import { getDb } from './_lib/firebase.mjs';
import { renderBill, renderSlip, toEscPos, SAMPLE_ORDER, SAMPLE_JOB, SAMPLE_SEL, SAMPLE_PO } from './_lib/bill.mjs';
import { FieldValue } from 'firebase-admin/firestore';
import { buildStatus, STATUS_HTML } from './_lib/statuspage.mjs';

async function loadOrders(db) {
  const snap = await db.collection('store').doc('orders').get();
  if (!snap.exists) return [];
  try { return JSON.parse(snap.data().value) || []; } catch { return []; }
}

// seller id -> seller name, from the sellers list of the admin panel (so every new seller prints too)
async function loadSellerNames(db) {
  try {
    const snap = await db.collection('store').doc('sellers').get();
    if (!snap.exists) return {};
    const list = JSON.parse(snap.data().value) || [];
    const map = {};
    for (const s of list) if (s && s.id && s.name) map[s.id] = String(s.name).toUpperCase();
    return map;
  } catch { return {}; }
}

// seller ids whose name matches (e.g. /laxman/i) -> the sellers added in the admin panel
async function loadSellerIdsByName(db, re) {
  const ids = new Set();
  try {
    const snap = await db.collection('store').doc('sellers').get();
    if (!snap.exists) return ids;
    const list = JSON.parse(snap.data().value) || [];
    for (const s of list) if (s && s.id && re.test(String(s.name || ''))) ids.add(s.id);
  } catch { /* ignore */ }
  return ids;
}

// which printer is calling? (decided by the key)
function identifyPrinter(key) {
  if (!key) return null;
  if (process.env.PRINT_KEY && key === process.env.PRINT_KEY) return { tag: 'main', doc: 'printState', match: null };
  if (process.env.PRINT_KEY_LAXMAN && key === process.env.PRINT_KEY_LAXMAN) return { tag: 'laxman', doc: 'printState_laxman', match: /laxman/i };
  if (process.env.PRINT_KEY_AARTI && key === process.env.PRINT_KEY_AARTI) return { tag: 'aarti', doc: 'printState_aarti', match: /aarti/i };
  return null;
}

// seller id of one order item (older orders: use the product's seller as it is now)
async function itemSellerId(db, it, cache) {
  if (it.sellerId) return it.sellerId;
  if (!it.id) return '';
  if (cache[it.id] !== undefined) return cache[it.id];
  let sid = '';
  try {
    const ps = await db.collection('store').doc('product__' + it.id).get();
    if (ps.exists) sid = ps.data().sellerId || '';
  } catch { /* ignore */ }
  cache[it.id] = sid;
  return sid;
}

async function orderHasSeller(db, o, sellerIds, cache) {
  for (const it of o.items || []) {
    if (sellerIds.has(await itemSellerId(db, it, cache))) return true;
  }
  return false;
}

export default async function handler(req, res) {
  const key = req.headers['x-print-key'] || req.query.key;
  const printer = identifyPrinter(key);
  if (!printer) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const action = String(req.query.action || 'next');
  const id = req.query.id ? String(req.query.id) : '';

  try {
    if (action === 'statuspage') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(STATUS_HTML);
    }

    const db = getDb();
    const stateRef = db.collection('store').doc(printer.doc);

    if (action === 'next') {
      const stSnap = await stateRef.get();
      const st = stSnap.exists ? stSnap.data() : {};
      const nowMs = Date.now();
      if (!st.lastSeen || nowMs - Date.parse(st.lastSeen) > 60000) {
        await stateRef.set({ lastSeen: new Date(nowMs).toISOString() }, { merge: true });   // at most one write per minute
      }
      const extra = st.checkRequested ? { check: true } : {};
      if (st.testPending) return res.status(200).json({ id: 'test', orderNumber: 0, ...extra });
      if (!st.startAt) {
        // first run: only orders placed from now on will be printed
        await stateRef.set({ startAt: new Date().toISOString(), printedIds: [] }, { merge: true });
        return res.status(200).json({ none: true, note: 'print start time set', ...extra });
      }
      const printed = new Set(st.printedIds || []);
      const startMs = new Date(st.startAt).getTime();
      const orders = await loadOrders(db);
      let pick = null;
      if (!printer.match) {
        orders.forEach((o, idx) => {
          const t = new Date(o.createdAt).getTime();
          if (!o.id || printed.has(o.id) || !(t >= startMs)) return;
          if (!pick || t < pick.t) pick = { id: o.id, t, orderNumber: orders.length - idx };
        });
      } else {
        // seller printer: oldest unprinted order that has this seller's items; other orders are marked as skipped
        const sellerIds = await loadSellerIdsByName(db, printer.match);
        if (!sellerIds.size) return res.status(200).json({ none: true, note: 'seller not found in sellers list', ...extra });
        const cands = [];
        orders.forEach((o, idx) => {
          const t = new Date(o.createdAt).getTime();
          if (!o.id || printed.has(o.id) || !(t >= startMs)) return;
          cands.push({ o, t, orderNumber: orders.length - idx });
        });
        cands.sort((a, b) => a.t - b.t);
        const cache = {};
        const skipIds = [];
        for (const c of cands) {
          if (await orderHasSeller(db, c.o, sellerIds, cache)) { pick = { id: c.o.id, t: c.t, orderNumber: c.orderNumber }; break; }
          skipIds.push(c.o.id);
        }
        if (skipIds.length) await stateRef.set({ printedIds: FieldValue.arrayUnion(...skipIds) }, { merge: true });
      }
      // job application / seller registration slips waiting in the queue (main printer only)
      const queue = printer.match ? {} : (st.queue || {});
      Object.entries(queue).forEach(([qid, it]) => {
        if (!it || !(Number(it.t) > 0)) return;
        if (!pick || it.t < pick.t) pick = { id: qid, t: it.t, orderNumber: it.no || 0 };
      });
      return res.status(200).json(pick ? { id: pick.id, orderNumber: pick.orderNumber, ...extra } : { none: true, ...extra });
    }

    if ((action === 'job' || action === 'preview') && (/^(ja|sr|po)_[A-Za-z0-9_-]+$/.test(id) || id === 'sample_job' || id === 'sample_sel' || id === 'sample_po')) {
      let item;
      if (id === 'sample_job') item = { ...SAMPLE_JOB, t: Date.now() };
      else if (id === 'sample_sel') item = { ...SAMPLE_SEL, t: Date.now() };
      else if (id === 'sample_po') item = { ...SAMPLE_PO, t: Date.now() };
      else {
        const qs = await stateRef.get();
        item = qs.exists ? (qs.data().queue || {})[id] : null;
        if (!item) return res.status(404).json({ error: 'slip not found (already printed?)' });
      }
      const slip = renderSlip(item);
      if (action === 'preview') {
        res.setHeader('Content-Type', 'image/png');
        return res.status(200).send(slip.toBuffer('image/png'));
      }
      const slipBytes = toEscPos(slip);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(slipBytes.length));
      return res.status(200).send(slipBytes);
    }

    if (action === 'job' || action === 'preview') {
      let order, num;
      if (id === 'test' || id === 'sample') {
        order = { ...SAMPLE_ORDER, createdAt: new Date().toISOString() }; num = 0;
      } else {
        const orders = await loadOrders(db);
        const idx = orders.findIndex((o) => o.id === id);
        if (idx < 0) return res.status(404).json({ error: 'order not found' });
        order = orders[idx]; num = orders.length - idx;
      }
      const names = await loadSellerNames(db);
      const onlySellerIds = (printer.match && id !== 'test' && id !== 'sample') ? await loadSellerIdsByName(db, printer.match) : null;
      const cache = {};
      const itemsWithParty = [];
      for (const it of order.items || []) {
        const sid = await itemSellerId(db, it, cache);   // order saved before the product had a seller -> use the product's seller as it is now
        if (onlySellerIds && !onlySellerIds.has(sid)) continue;   // seller printer: only this seller's items
        itemsWithParty.push({ ...it, partyName: names[sid] || '' });
      }
      if (onlySellerIds) {
        if (!itemsWithParty.length) return res.status(404).json({ error: 'no items of this seller in the order' });
        const sum = itemsWithParty.reduce((a, it) => a + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
        order = { ...order, items: itemsWithParty, total: sum };   // bill shows only this seller's items and total
      } else {
        order = { ...order, items: itemsWithParty };
      }
      const canvas = renderBill(order, num);
      if (action === 'preview') {
        res.setHeader('Content-Type', 'image/png');
        return res.status(200).send(canvas.toBuffer('image/png'));
      }
      const bytes = toEscPos(canvas);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(bytes.length));
      return res.status(200).send(bytes);
    }

    if (action === 'done') {
      const ms = parseInt(String(req.query.ms || ''), 10);
      const patch = { lastPrintedAt: new Date().toISOString(), lastPrintedId: id, lastPrintMs: Number.isFinite(ms) ? ms : null };
      if (/^(ja|sr|po)_[A-Za-z0-9_-]+$/.test(id)) {
        // printed slip: take it out of the queue
        await stateRef.update({ ...patch, ['queue.' + id]: FieldValue.delete() });
        return res.status(200).json({ ok: true });
      }
      if (id === 'test') patch.testPending = false;
      else if (id) patch.printedIds = FieldValue.arrayUnion(id);
      await stateRef.set(patch, { merge: true });
      return res.status(200).json({ ok: true });
    }

    if (action === 'fail') {
      // ESP32 could not print: remember why (at most one write per minute for the same reason)
      const why = String(req.query.why || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
      const snap = await stateRef.get();
      const st = snap.exists ? snap.data() : {};
      const recent = st.lastFailAt && st.lastFailWhy === why && Date.now() - Date.parse(st.lastFailAt) < 60000;
      const patch = recent ? {} : { lastFailAt: new Date().toISOString(), lastFailWhy: why, lastFailId: id };
      if (id === 'test') patch.testPending = false;   // the test bill is one-shot: never let it block real orders
      if (Object.keys(patch).length) await stateRef.set(patch, { merge: true });
      return res.status(200).json({ ok: true });
    }

    if (action === 'check') {   // button on the status page -> ESP32 tests the printer connection
      await stateRef.set({ checkRequested: true, checkRequestedAt: new Date().toISOString() }, { merge: true });
      return res.status(200).json({ ok: true });
    }

    if (action === 'pcheck') {  // ESP32 reports the result of that test
      await stateRef.set({ printerCheckAt: new Date().toISOString(), printerCheckOk: String(req.query.ok) === '1', checkRequested: false }, { merge: true });
      return res.status(200).json({ ok: true });
    }

    if (action === 'status') {
      const snap = await stateRef.get();
      const orders = await loadOrders(db);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(buildStatus(snap.exists ? snap.data() : {}, orders, Date.now()));
    }

    if (action === 'reprint') {
      // /api/print?action=reprint&n=70  -> prints admin-panel order number 70 once more
      const n = parseInt(String(req.query.n || ''), 10);
      const orders = await loadOrders(db);
      const o = n >= 1 ? orders[orders.length - n] : null;
      if (!o || !o.id) return res.status(404).json({ error: 'order number not found' });
      await stateRef.set({ printedIds: FieldValue.arrayRemove(o.id) }, { merge: true });
      return res.status(200).json({ ok: true, order: n, id: o.id, note: 'will print within ~10 seconds' });
    }

    if (action === 'test') {
      await stateRef.set({ testPending: true }, { merge: true });
      return res.status(200).json({ ok: true, note: 'test bill queued - ESP32 will print it within ~5 seconds' });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
