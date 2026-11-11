/**
 * Move account passwords off public user profiles.
 * Plaintext values are hashed. The hash is stored at
 * users/{id}/private/credentials and the profile field is removed.
 *
 * Usage (service account via GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT):
 *   NODE_PATH=functions/node_modules node scripts/migratePasswords.mjs
 */
import { createHash } from 'node:crypto';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function initAdmin() {
  if (getApps().length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    initializeApp({ credential: cert(JSON.parse(raw)) });
    return;
  }
  initializeApp({ credential: applicationDefault() });
}

function hashPassword(password) {
  return `sha256:${createHash('sha256').update(password, 'utf8').digest('hex')}`;
}

initAdmin();
const db = getFirestore();

const snap = await db.collection('users').get();
let moved = 0;
for (const doc of snap.docs) {
  const password = doc.get('password');
  if (typeof password !== 'string' || !password) continue;
  const passwordHash = password.startsWith('sha256:') ? password : hashPassword(password);
  await doc.ref.collection('private').doc('credentials').set({ passwordHash });
  await doc.ref.update({ password: FieldValue.delete() });
  moved += 1;
}
console.log(`Moved ${moved} password field(s) off public profiles.`);
