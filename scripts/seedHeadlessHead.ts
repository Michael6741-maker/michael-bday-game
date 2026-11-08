/**
 * Admin seed for Headless Head catalog row (MIE-47).
 * Same rules as client ensureHeadlessHeadCatalogItem — never resets stock on existing docs.
 */
import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { HEADLESS_HEAD_CATALOG_FIELDS, HEADLESS_HEAD_ITEM_ID } from '../app/lib/avatarItems';

const AVATAR_ITEMS_COLLECTION = 'avatarItems';

function parseServiceAccount(): ServiceAccount | null {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawServiceAccount) return null;
  try {
    return JSON.parse(rawServiceAccount) as ServiceAccount;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid service account JSON.');
  }
}

function initializeAdminApp() {
  if (getApps().length > 0) return;
  const projectId = process.env.FIREBASE_PROJECT_ID ?? 'michaels-web-game';
  const serviceAccount = parseServiceAccount();
  initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    projectId,
  });
}

async function seedHeadlessHead() {
  initializeAdminApp();
  const db = getFirestore();
  const ref = db.collection(AVATAR_ITEMS_COLLECTION).doc(HEADLESS_HEAD_ITEM_ID);
  const snap = await ref.get();
  if (snap.exists) {
    console.log(`Headless Head already present (${HEADLESS_HEAD_ITEM_ID}); stock unchanged.`);
    return;
  }
  const now = Date.now();
  await ref.set({
    id: HEADLESS_HEAD_ITEM_ID,
    ...HEADLESS_HEAD_CATALOG_FIELDS,
    createdAtMs: now,
    updatedAtMs: now,
  });
  console.log(`Seeded Headless Head (${HEADLESS_HEAD_ITEM_ID}) with stock 20,000.`);
}

seedHeadlessHead().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
