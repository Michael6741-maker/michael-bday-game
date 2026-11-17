/**
 * Pure ban helpers shared by Cloud Functions.
 * The client copy of the player-facing message lives in app/lib/ban.ts.
 * Keep formatBanMessage identical in both places.
 */

export const BAN_REASON_MAX = 280;
export const PLAY_LEASE_MS = 45 * 1000;
export const MAX_RECORDED_NETWORKS = 16;

export function formatBanMessage(reason: string): string {
  return `Error 600, you have been ban from this game (Reason: ${reason})`;
}

export function sanitizeBanReason(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const reason = input.trim().replace(/\s+/g, ' ');
  if (!reason || reason.length > BAN_REASON_MAX) return null;
  return reason;
}

export function isBanActive(
  ban: { permanent?: boolean; endsAtMs?: number | null } | null | undefined,
  now: number,
): boolean {
  if (!ban) return false;
  if (ban.permanent === true) return true;
  return typeof ban.endsAtMs === 'number' && Number.isFinite(ban.endsAtMs) && ban.endsAtMs > now;
}

function headerText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string' && part).join(',');
  return typeof value === 'string' ? value : '';
}

/** Strip port, brackets, and IPv4-mapped IPv6 prefix. */
export function normalizeIp(raw: string): string {
  let ip = raw.trim();
  if (!ip) return '';
  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end > 0) ip = ip.slice(1, end);
  }
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (isIpv4(mapped)) return mapped;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
    return ip.slice(0, ip.lastIndexOf(':'));
  }
  return ip;
}

function isIpv4(ip: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return false;
  return match.slice(1).every((octet) => {
    const n = Number(octet);
    return n <= 255 && String(n) === String(Number(octet));
  });
}

function ipv6Prefix64(ip: string): string | null {
  if (!ip.includes(':') || ip.includes('.')) return null;
  if (ip.split('::').length > 2) return null;

  let parts: string[];
  if (!ip.includes('::')) {
    parts = ip.split(':');
  } else {
    const [head, tail] = ip.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    parts = [...headParts, ...Array(missing).fill('0'), ...tailParts];
  }

  if (parts.length !== 8) return null;
  const normalized: string[] = [];
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    normalized.push(part.toLowerCase().replace(/^0+/, '') || '0');
  }
  return normalized.slice(0, 4).join(':');
}

/**
 * Network key observed by the server.
 * IPv4 uses the full address (one NAT / Wi-Fi shares one public IPv4).
 * IPv6 uses the /64 LAN prefix (devices on one network share it).
 */
export function networkKeyFromIp(rawIp: string): string | null {
  const ip = normalizeIp(rawIp);
  if (!ip) return null;
  if (isIpv4(ip)) return `ip4:${ip}`;
  const prefix = ipv6Prefix64(ip);
  if (!prefix) return null;
  return `ip6:${prefix}`;
}

export interface ClientIpRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
}

/**
 * Client address as the platform observes it.
 * Prefer x-appengine-user-ip (set by the Google frontend). Otherwise use the
 * last X-Forwarded-For hop, which the proxy appends — the first hop can be spoofed.
 */
function usableIp(raw: string | null | undefined): string {
  if (!raw) return '';
  const ip = normalizeIp(raw);
  return networkKeyFromIp(ip) ? ip : '';
}

export function extractClientIp(req: ClientIpRequest | null | undefined): string {
  if (!req) return '';
  const headers = req.headers ?? {};
  const appEngine = usableIp(headerText(headers['x-appengine-user-ip']).trim());
  if (appEngine) return appEngine;
  const forwarded = headerText(headers['x-forwarded-for']);
  if (forwarded) {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    const last = usableIp(hops[hops.length - 1]);
    if (last) return last;
  }
  return usableIp(req.ip) || usableIp(req.socket?.remoteAddress) || '';
}
