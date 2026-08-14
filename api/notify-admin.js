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
//                                 key. Paste the whole { ... } JSON as-is.
//
// This version never crashes at startup — any setup problem (missing
// variable, broken JSON, etc.) is caught and returned as a normal JSON
// response with a clear "step" and "message", so it shows up directly in
// the response instead of just "FUNCTION_INVOCATION_FAILED" in the logs.

import admin from "firebase-admin";

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw { step: "env-missing", message: "FIREBASE_SERVICE_ACCOUNT environment variable is not set (or empty) for this deployment." };
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    throw { step: "json-parse", message: "FIREBASE_SERVICE_ACCOUNT is not valid JSON: " + e.message };
  }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw { step: "json-shape", message: "FIREBASE_SERVICE_ACCOUNT JSON is missing project_id / client_email / private_key." };
  }
  if (!admin.apps.length) {
    try {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      throw { step: "admin-init", message: "admin.initializeApp failed: " + e.message };
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    initFirebase();
  } catch (e) {
    console.error("notify-admin init error", e);
    res.status(200).json({ ok: false, ...e });
    return;
  }

  try {
    const db = admin.firestore();
    const tokenDoc = await db.collection("store").doc("adminFcmToken").get();
    const token = tokenDoc.exists ? tokenDoc.data().value : null;

    if (!token) {
      res.status(200).json({ ok: false, step: "no-token", message: "No admin device is registered yet (store/adminFcmToken is empty). Tap the notification button in the admin panel first." });
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
    console.error("notify-admin send error", e);
    res.status(200).json({ ok: false, step: "send", message: String(e && e.message ? e.message : e) });
  }
}
