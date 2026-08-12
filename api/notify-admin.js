// /api/notify-admin.js
// Vercel serverless function. Called by the app right after a customer places
// an order. Sends a real push notification (via Firebase Cloud Messaging) to
// the admin's saved device token — this reaches the admin even if their
// app/tab is closed.
//
// Needs the FIREBASE_SERVICE_ACCOUNT environment variable set in Vercel
// (Settings > Environment Variables) containing the full JSON key downloaded
// from Firebase Console > Project Settings > Service Accounts.
//
// No extra npm packages needed — uses Node's built-in crypto to sign a JWT
// and exchange it for a Google OAuth2 access token directly.

const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(serviceAccount) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(serviceAccount.private_key)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Google token exchange failed: " + JSON.stringify(data));
  }
  return data.access_token;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is missing");
    const serviceAccount = JSON.parse(raw);
    const projectId = serviceAccount.project_id;

    const accessToken = await getAccessToken(serviceAccount);

    // Read the admin's saved FCM token from Firestore (store/adminFcmToken),
    // saved by enableOrderNotifications() in the app.
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/store/adminFcmToken`;
    const fsRes = await fetch(firestoreUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!fsRes.ok) {
      // No token saved yet (admin hasn't enabled notifications) — not an error.
      res.status(200).json({ skipped: true, reason: "no admin push token saved yet" });
      return;
    }
    const fsData = await fsRes.json();
    const deviceToken = fsData.fields && fsData.fields.value && fsData.fields.value.stringValue;
    if (!deviceToken) {
      res.status(200).json({ skipped: true, reason: "admin push token empty" });
      return;
    }

    const body = req.body || {};
    const customerName = body.customerName || "ગ્રાહક";
    const total = body.total || "";
    const orderId = body.orderId || "";

    const message = {
      message: {
        token: deviceToken,
        notification: {
          title: "🛍️ નવો ઓર્ડર આવ્યો!",
          body: `${customerName} — ₹${total}`,
        },
        data: { orderId: String(orderId) },
        webpush: {
          fcm_options: { link: "/" },
        },
      },
    };

    const sendRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      }
    );
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      console.error("FCM send failed", sendData);
      res.status(500).json({ error: sendData });
      return;
    }
    res.status(200).json({ success: true, result: sendData });
  } catch (e) {
    console.error("notify-admin error", e);
    res.status(500).json({ error: e.message || "unknown error" });
  }
};
