'use client';

import { useEffect, useState } from 'react';
import { waitForAuth } from '../lib/firebase';
import PlayerSettingsProvider from './PlayerSettingsProvider';

/**
 * Client-side provider bundle for the root layout.
 * Keeps server layout.tsx free of client-only context.
 * Waits until a persisted Firebase Auth session is loaded so account rules
 * see the signed-in player before the first Firestore read.
 */
export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    waitForAuth()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;
  return <PlayerSettingsProvider>{children}</PlayerSettingsProvider>;
}
