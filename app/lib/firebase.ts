// Firebase configuration and initialization
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { getFunctions, Functions } from 'firebase/functions';

// Client Firebase config is injected at build time via NEXT_PUBLIC_* env vars.
// Copy .env.example to .env.local for local dev; CI injects the same keys via GitHub secrets.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'michaels-web-game',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
};

declare global {
  var __PLATFORM_DROP_FIRESTORE_EMULATOR_CONNECTED__: boolean | undefined;
}

// Initialize Firebase app (singleton pattern to prevent multiple initializations)
let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize Firestore
export const db: Firestore = getFirestore(app);

// Local manual tests can opt into the Firestore emulator without changing
// production behavior; HMR may reload this module, so guard the one-time connect.
const firestoreEmulatorHost = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
if (firestoreEmulatorHost && !globalThis.__PLATFORM_DROP_FIRESTORE_EMULATOR_CONNECTED__) {
  const [host, port] = firestoreEmulatorHost.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  globalThis.__PLATFORM_DROP_FIRESTORE_EMULATOR_CONNECTED__ = true;
}

// Initialize Firebase Functions
export const functions: Functions = getFunctions(app);

// Auth is created on first use. Calling getAuth() at import time rejects an
// empty API key and breaks `next build` before CI injects NEXT_PUBLIC_FIREBASE_*.
let authInstance: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (!authInstance) authInstance = getAuth(app);
  return authInstance;
}

/** Resolve once the persisted Firebase Auth user (if any) has been loaded. */
export function waitForAuth(): Promise<void> {
  return getFirebaseAuth().authStateReady();
}
