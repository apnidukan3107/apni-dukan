import admin from "firebase-admin";

let initError = null;

if (!admin.apps.length) {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!raw) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is missing (empty).");
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch (parseErr) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON. Parse error: " + parseErr.message);
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    initError = e;
    console.error("notify-admin: Firebase Admin init failed:", e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (initError) {
    res.status(500).json({
      ok: false,
      error: "firebase-init-failed",
      message: initError.message,
    });
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
