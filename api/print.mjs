// One endpoint for the ESP32 printer:
//   GET /api/print?action=next            -> {id, orderNumber} or {none:true}
//   GET /api/print?action=job&id=ORDERID  -> ESC/POS bytes (bill as image)
//   GET /api/print?action=done&id=ORDERID -> marks as printed
//   GET /api/print?action=test            -> queues one sample bill (to test the printer)
//   GET /api/print?action=preview&id=ORDERID  (or id=sample) -> PNG preview in the browser
// Auth: header "x-print-key" (or ?key=) must equal the PRINT_KEY env variable.
import { getDb } from './_lib/firebase.mjs';
import { renderBill, toEscPos, SAMPLE_ORDER } from './_lib/bill.mjs';
import { FieldValue } from 'firebase-admin/firestore';

async function loadOrders(db) {
  const snap = await db.collection('store').doc('orders').get();
  if (!snap.exists) return [];
  try { return JSON.parse(snap.data().value) || []; } catch { return []; }
}

export default async function handler(req, res) {
  const key = req.headers['x-print-key'] || req.query.key;
  if (!process.env.PRINT_KEY || key !== process.env.PRINT_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const action = String(req.query.action || 'next');
  const id = req.query.id ? String(req.query.id) : '';

  try {
    const db = getDb();
    const stateRef = db.collection('store').doc('printState');

    if (action === 'next') {
      const stSnap = await stateRef.get();
      const st = stSnap.exists ? stSnap.data() : {};
      if (st.testPending) return res.status(200).json({ id: 'test', orderNumber: 0 });
      if (!st.startAt) {
        // first run: only orders placed from now on will be printed
        await stateRef.set({ startAt: new Date().toISOString(), printedIds: [] }, { merge: true });
        return res.status(200).json({ none: true, note: 'print start time set' });
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
      return res.status(200).json(pick ? { id: pick.id, orderNumber: pick.orderNumber } : { none: true });
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
      if (id === 'test') await stateRef.set({ testPending: false }, { merge: true });
      else if (id) await stateRef.set({ printedIds: FieldValue.arrayUnion(id) }, { merge: true });
      return res.status(200).json({ ok: true });
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
