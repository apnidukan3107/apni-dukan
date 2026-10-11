// api/print-order.js
//
// The admin's "Bluetooth Print" / Thermer app opens this URL itself (via the
// my.bluetoothprint.scheme:// link App.jsx triggers for every new order) and
// expects back a JSON array describing what to print. This reads that one
// order straight from the same Firestore doc ("store/orders") the app
// already uses, and formats it as a 58mm receipt.

const PROJECT_ID = "apni-dukan-b8e19";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const orderId = req.query.id;
  if (!orderId) {
    res.status(400).json([{ type: 0, content: "Order id missing", bold: 1, align: 1 }]);
    return;
  }

  try {
    const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/store`;

    const [ordersRes, sellersRes] = await Promise.all([
      fetch(`${base}/orders`),
      fetch(`${base}/sellers`),
    ]);
    const ordersData = await ordersRes.json();
    const sellersData = await sellersRes.json();

    const ordersRaw = ordersData && ordersData.fields && ordersData.fields.value && ordersData.fields.value.stringValue;
    const orders = ordersRaw ? JSON.parse(ordersRaw) : [];
    const order = orders.find((o) => o.id === orderId);

    const sellersRaw = sellersData && sellersData.fields && sellersData.fields.value && sellersData.fields.value.stringValue;
    const sellers = sellersRaw ? JSON.parse(sellersRaw) : [];
    const sellerName = (sellerId) => {
      const s = sellers.find((x) => x.id === sellerId);
      return s ? s.name : "Apni Dukan";
    };

    if (!order) {
      res.status(200).json([{ type: 0, content: "Order not found: " + orderId, bold: 1, align: 1 }]);
      return;
    }

    const lines = [];
    lines.push({ type: 0, content: "Apni Dukan", bold: 1, align: 1, format: 3 });
    lines.push({ type: 0, content: "apnidukanse.in", bold: 0, align: 1, format: 4 });
    lines.push({ type: 0, content: " ", bold: 0, align: 0 });
    lines.push({ type: 0, content: "Order #" + String(order.id).slice(-4), bold: 1, align: 0 });

    const dt = order.createdAt ? new Date(order.createdAt) : new Date();
    lines.push({ type: 0, content: dt.toLocaleString("en-IN"), bold: 0, align: 0, format: 4 });
    lines.push({ type: 0, content: "--------------------------------", bold: 0, align: 0 });

    const custName = (order.customer && order.customer.name) || "Customer";
    lines.push({ type: 0, content: custName, bold: 1, align: 0 });
    if (order.customer && order.customer.phone) {
      lines.push({ type: 0, content: order.customer.phone, bold: 0, align: 0 });
    }
    if (order.customer && order.customer.address) {
      lines.push({ type: 0, content: order.customer.address, bold: 0, align: 0 });
    }
    lines.push({ type: 0, content: "--------------------------------", bold: 0, align: 0 });

    // Group items by seller, so the bill shows at a glance which items
    // belong to which vepari (e.g. Sandhya Traders, B.M. Traders) and which
    // ones are Apni Dukan's own.
    const groups = {};
    const groupOrder = [];
    (order.items || []).forEach((it) => {
      const key = it.sellerId || "__own__";
      if (!groups[key]) {
        groups[key] = [];
        groupOrder.push(key);
      }
      groups[key].push(it);
    });

    groupOrder.forEach((key) => {
      const label = key === "__own__" ? "Apni Dukan" : sellerName(key);
      lines.push({ type: 0, content: `[ ${label} ]`, bold: 1, align: 0 });
      groups[key].forEach((it) => {
        const qty = it.qty || 1;
        const amt = (it.price || 0) * qty;
        lines.push({ type: 0, content: `  ${it.name} x${qty} = Rs.${amt}`, bold: 0, align: 0 });
      });
    });

    lines.push({ type: 0, content: "--------------------------------", bold: 0, align: 0 });
    lines.push({ type: 0, content: "TOTAL: Rs." + order.total, bold: 1, align: 2, format: 1 });
    lines.push({ type: 0, content: " ", bold: 0, align: 0 });
    lines.push({ type: 0, content: "Thank you! Aavjo!", bold: 0, align: 1 });
    lines.push({ type: 0, content: " ", bold: 0, align: 0 });
    lines.push({ type: 0, content: " ", bold: 0, align: 0 });

    res.status(200).json(lines);
  } catch (err) {
    res.status(200).json([{ type: 0, content: "Print error: " + String((err && err.message) || err), bold: 1, align: 1 }]);
  }
};
