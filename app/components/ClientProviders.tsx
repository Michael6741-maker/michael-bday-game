'use client';

import PlayerSettingsProvider from './PlayerSettingsProvider';
import BanGate from './BanGate';

/**
 * Client-side provider bundle for the root layout.
 * Keeps server layout.tsx free of client-only context.
 */
export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PlayerSettingsProvider>
      <BanGate>{children}</BanGate>
    </PlayerSettingsProvider>
  );
}
