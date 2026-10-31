// One endpoint for the ESP32 printer:
//   GET /api/print?action=next            -> {id, orderNumber} or {none:true}
//   GET /api/print?action=job&id=ORDERID  -> ESC/POS bytes (bill as image)
//   GET /api/print?action=done&id=ORDERID -> marks as printed
//   GET /api/print?action=test            -> queues one sample bill (to test the printer)
//   GET /api/print?action=reprint&n=70    -> prints admin order number 70 once more
//   GET /api/print?action=statuspage      -> status page (open in the phone browser, add ?key=...)
//   action=status | check | pcheck | fail  -> used by the status page and the ESP32
//   GET /api/print?action=preview&id=ORDERID  (or id=sample) -> PNG preview in the browser
//   Job application / seller registration slips: queued by the app in printState.queue (ids ja_... / sr_...),
//   preview with id=sample_job or id=sample_sel. They print in the same line as orders, oldest first.
// Auth: header "x-print-key" (or ?key=) must equal the PRINT_KEY env variable.
import { getDb } from './_lib/firebase.mjs';
import { renderBill, renderSlip, toEscPos, SAMPLE_ORDER, SAMPLE_JOB, SAMPLE_SEL } from './_lib/bill.mjs';
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

export default async function handler(req, res) {
  const key = req.headers['x-print-key'] || req.query.key;
  if (!process.env.PRINT_KEY || key !== process.env.PRINT_KEY) {
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
    const stateRef = db.collection('store').doc('printState');

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
      orders.forEach((o, idx) => {
        const t = new Date(o.createdAt).getTime();
        if (!o.id || printed.has(o.id) || !(t >= startMs)) return;
        if (!pick || t < pick.t) pick = { id: o.id, t, orderNumber: orders.length - idx };
      });
      // job application / seller registration slips waiting in the queue (same printState doc -> no extra read)
      const queue = st.queue || {};
      Object.entries(queue).forEach(([qid, it]) => {
        if (!it || !(Number(it.t) > 0)) return;
        if (!pick || it.t < pick.t) pick = { id: qid, t: it.t, orderNumber: it.no || 0 };
      });
      return res.status(200).json(pick ? { id: pick.id, orderNumber: pick.orderNumber, ...extra } : { none: true, ...extra });
    }

    if ((action === 'job' || action === 'preview') && (/^(ja|sr)_[A-Za-z0-9_-]+$/.test(id) || id === 'sample_job' || id === 'sample_sel')) {
      let item;
      if (id === 'sample_job') item = { ...SAMPLE_JOB, t: Date.now() };
      else if (id === 'sample_sel') item = { ...SAMPLE_SEL, t: Date.now() };
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
      const itemsWithParty = [];
      for (const it of order.items || []) {
        let sid = it.sellerId;
        if (!sid && it.id) {   // order saved before the product had a seller -> use the product's seller as it is now
          try {
            const ps = await db.collection('store').doc('product__' + it.id).get();
            if (ps.exists) sid = ps.data().sellerId || '';
          } catch { /* ignore */ }
        }
        itemsWithParty.push({ ...it, partyName: names[sid] || '' });
      }
      order = { ...order, items: itemsWithParty };
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
      if (/^(ja|sr)_[A-Za-z0-9_-]+$/.test(id)) {
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
