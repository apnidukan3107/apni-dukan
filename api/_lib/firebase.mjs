// Firestore (admin) connection. Reuses whichever credential env variable your project already has.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function fixKey(j) {
  if (j.private_key) j.private_key = j.private_key.replace(/\\n/g, '\n');
  return j;
}

export function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
      || process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      || process.env.FIREBASE_ADMIN_KEY
      || process.env.GOOGLE_SERVICE_ACCOUNT;
    let credential;
    if (raw) {
      const txt = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      credential = cert(fixKey(JSON.parse(txt)));
    } else if (process.env.FIREBASE_PRIVATE_KEY) {
      credential = cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else {
      throw new Error('Firebase admin credentials (env variable) malya nahi');
    }
    initializeApp({ credential });
  }
  return getFirestore();
}
