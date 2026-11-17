/** Player-facing ban copy. Cloud Functions duplicate this string in functions/src/banPure.ts. */

export interface BanStatus {
  reason: string;
  permanent?: boolean;
  endsAtMs?: number | null;
}

export function formatBanMessage(reason: string): string {
  return `Error 600, you have been ban from this game (Reason: ${reason})`;
}

/** Direct ban is active until unban, or until a temporal ban's end time. */
export function isBanStatusActive(status: BanStatus | null | undefined, now = Date.now()): boolean {
  if (!status) return false;
  if (status.permanent === true) return true;
  return typeof status.endsAtMs === 'number' && Number.isFinite(status.endsAtMs) && status.endsAtMs > now;
}
