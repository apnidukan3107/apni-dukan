// Vercel serverless function — sends a real push notification to the
// admin's registered device via Firebase Cloud Messaging whenever a new
// order is placed. Called from the client right after an order is saved
// (see placeOrder() in App.jsx, which calls fetch("/api/notify-admin")).
//
// Needs ONE environment variable set in the Vercel project dashboard
// (Settings → Environments → Production → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT  -> the ENTIRE contents of the service
//                                 account JSON file downloaded from
//                                 Firebase Console → Project settings →
//                                 Service accounts → Generate new private
//                                 key. Paste the whole { ... } JSON as-is
//                                 into the Value field.

import admin from "firebase-admin";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const db = admin.firestore();
    const tokenDoc = await db.collection("store").doc("adminFcmToken").get();
    const token = tokenDoc.exists ? tokenDoc.data().value : null;

    if (!token) {
      res.status(200).json({ ok: false, reason: "no-admin-token-registered" });
      return;
    }

    const { customerName, total } = req.body || {};

    await admin.messaging().send({
      token,
      notification: {
        title: "🛍️ નવો ઓર્ડર આવ્યો!",
        body: `${customerName || "ગ્રાહક"} — ₹${total || ""}`,
      },
      webpush: {
        fcmOptions: {
          link: "https://apni-dukan-togl.vercel.app/",
        },
      },
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("notify-admin error", e);
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
