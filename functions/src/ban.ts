/**
 * Server-side bans.
 *
 * A website cannot see Wi-Fi names. Cloud Functions record the client IP the
 * platform observes (x-appengine-user-ip, else the last X-Forwarded-For hop)
 * and store a network key on the ban: full IPv4, or IPv6 /64. Accounts that
 * later show up on a recorded network are blocked until that ban ends.
 * Staff (isAdmin) are not swept up by a shared-network block, so an admin on
 * the same connection can still unban. A direct ban still applies to them.
 * Unban deletes ban documents only — coins, gems, items, and meters stay.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  extractClientIp,
  formatBanMessage,
  isBanActive,
  MAX_RECORDED_NETWORKS,
  networkKeyFromIp,
  PLAY_LEASE_MS,
  sanitizeBanReason,
  type ClientIpRequest,
} from './banPure';

function getDb() {
  return admin.firestore();
}

const USERS = 'users';
const BANS = 'bans';
const BAN_STATUS = 'banStatus';
const BANNED_NETWORKS = 'bannedNetworks';
const USER_NETWORKS = 'userNetworks';

export interface PlayAccessDecision {
  banned: boolean;
  reason: string;
  message: string;
  permanent: boolean;
  endsAtMs: number | null;
}

interface BanRecord {
  username: string;
  reason: string;
  permanent: boolean;
  endsAtMs: number | null;
  networks: string[];
  observedIps: string[];
  bannedBy: string;
  createdAtMs: number;
}

const CLEAR: PlayAccessDecision = {
  banned: false,
  reason: '',
  message: '',
  permanent: false,
  endsAtMs: null,
};

function requestNetwork(context: functions.https.CallableContext): { ip: string; networkKey: string | null } {
  const req = context?.rawRequest as ClientIpRequest | undefined;
  let ip = extractClientIp(req);
  // Production Cloud Functions set x-appengine-user-ip / X-Forwarded-For.
  // The local functions emulator delivers the call over a Unix socket and does
  // not forward that address (FUNCTIONS_EMULATOR=true). Use loopback only there
  // so accounts on this machine share one network during development.
  if (!ip && process.env.FUNCTIONS_EMULATOR === 'true') {
    ip = '127.0.0.1';
  }
  return { ip, networkKey: networkKeyFromIp(ip) };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function remember(list: string[], value: string | null | undefined): string[] {
  if (!value || list.includes(value)) return list;
  return [...list, value].slice(-MAX_RECORDED_NETWORKS);
}

async function resolveUserDocId(input: string): Promise<string | null> {
  const formatted = String(input ?? '').trim().replace(/\s+/g, ' ').slice(0, 10);
  if (!formatted || formatted.includes('/') || formatted === '.' || formatted === '..') return null;

  const direct = await getDb().collection(USERS).doc(formatted).get();
  if (direct.exists) return formatted;

  const compact = formatted.replace(/\s/g, '');
  if (/^[A-Za-z]{3}$/.test(compact)) {
    const legacyId = compact.toUpperCase();
    const legacy = await getDb().collection(USERS).doc(legacyId).get();
    if (legacy.exists) return legacyId;
  }

  const snap = await getDb().collection(USERS).where('usernameLower', '==', formatted.toLowerCase()).limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  return null;
}

async function loadUser(username: string, password: string): Promise<{ id: string; isAdmin: boolean }> {
  const id = await resolveUserDocId(username);
  if (!id) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  const snap = await getDb().collection(USERS).doc(id).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  const data = snap.data() as { password?: unknown; isAdmin?: unknown } | undefined;
  if (data?.password !== password) {
    throw new functions.https.HttpsError('permission-denied', 'Incorrect password');
  }
  return { id, isAdmin: data?.isAdmin === true };
}

async function requireAdmin(username: string, password: string): Promise<string> {
  if (!username || !password) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing admin username or password');
  }
  const adminUser = await loadUser(username, password);
  if (!adminUser.isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can ban or unban');
  }
  return adminUser.id;
}

function blockedDecision(ban: { reason?: unknown; permanent?: boolean; endsAtMs?: number | null }): PlayAccessDecision {
  const reason = typeof ban.reason === 'string' ? ban.reason : '';
  return {
    banned: true,
    reason,
    message: formatBanMessage(reason),
    permanent: ban.permanent === true,
    endsAtMs: typeof ban.endsAtMs === 'number' ? ban.endsAtMs : null,
  };
}

async function setPlayLease(username: string, expiresAt: number, networkKey?: string | null): Promise<void> {
  const patch: { playLeaseExpiresAt: number; activeNetworkKey?: string } = { playLeaseExpiresAt: expiresAt };
  // Only set the key when we observed one. Rules block writes while this key is banned,
  // even if a play lease has not expired yet.
  if (networkKey) patch.activeNetworkKey = networkKey;
  await getDb().collection(USERS).doc(username).update(patch);
}

async function revokePlayOnNetwork(networkKey: string): Promise<void> {
  const snap = await getDb().collection(USER_NETWORKS).where('networks', 'array-contains', networkKey).get();
  await Promise.all(snap.docs.map(async (networkDoc) => {
    const userRef = getDb().collection(USERS).doc(networkDoc.id);
    const userSnap = await userRef.get();
    if (!userSnap.exists || userSnap.data()?.isAdmin === true) return;
    await userRef.update({ playLeaseExpiresAt: 0 });
  }));
}

async function writeNetworkBan(networkKey: string, ban: BanRecord): Promise<void> {
  await getDb().collection(BANNED_NETWORKS).doc(networkKey).set({
    networkKey,
    username: ban.username,
    reason: ban.reason,
    permanent: ban.permanent,
    endsAtMs: ban.endsAtMs,
  });
  await revokePlayOnNetwork(networkKey);
}

async function releaseNetwork(networkKey: string, username: string): Promise<void> {
  const stillUsed = await getDb().collection(BANS).where('networks', 'array-contains', networkKey).limit(5).get();
  const owner = stillUsed.docs.find((docSnap) => docSnap.id !== username);
  if (!owner) {
    const netRef = getDb().collection(BANNED_NETWORKS).doc(networkKey);
    const netSnap = await netRef.get();
    if (netSnap.exists && netSnap.data()?.username === username) {
      await netRef.delete();
    }
    return;
  }
  const data = owner.data() as Partial<BanRecord>;
  await writeNetworkBan(networkKey, {
    username: owner.id,
    reason: typeof data.reason === 'string' ? data.reason : '',
    permanent: data.permanent === true,
    endsAtMs: typeof data.endsAtMs === 'number' ? data.endsAtMs : null,
    networks: asStringList(data.networks),
    observedIps: asStringList(data.observedIps),
    bannedBy: typeof data.bannedBy === 'string' ? data.bannedBy : '',
    createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : Date.now(),
  });
}

/** Delete ban rows only. Does not write coins, gems, items, meters, or other progress. */
export async function clearBan(username: string): Promise<boolean> {
  const banRef = getDb().collection(BANS).doc(username);
  const banSnap = await banRef.get();
  const networks = banSnap.exists ? asStringList(banSnap.data()?.networks) : [];
  if (banSnap.exists) await banRef.delete();
  await getDb().collection(BAN_STATUS).doc(username).delete();
  for (const networkKey of networks) {
    await releaseNetwork(networkKey, username);
  }
  return banSnap.exists;
}

async function activeNetworkBan(networkKey: string, now: number): Promise<PlayAccessDecision | null> {
  const netSnap = await getDb().collection(BANNED_NETWORKS).doc(networkKey).get();
  if (!netSnap.exists) return null;
  const net = netSnap.data() as { username?: string } | undefined;
  const owner = typeof net?.username === 'string' ? net.username : '';
  if (!owner) return null;
  const banSnap = await getDb().collection(BANS).doc(owner).get();
  if (!banSnap.exists) {
    await getDb().collection(BANNED_NETWORKS).doc(networkKey).delete();
    return null;
  }
  const ban = banSnap.data() as BanRecord;
  if (!isBanActive(ban, now)) {
    await clearBan(owner);
    return null;
  }
  return blockedDecision(ban);
}

async function recordNetwork(username: string, ip: string, networkKey: string | null): Promise<void> {
  if (!networkKey) return;
  const ref = getDb().collection(USER_NETWORKS).doc(username);
  const snap = await ref.get();
  const data = snap.data();
  const networks = remember(asStringList(data?.networks), networkKey);
  const observedIps = remember(asStringList(data?.observedIps), ip);
  await ref.set({
    networks,
    observedIps,
    lastIp: ip,
    updatedAtMs: Date.now(),
  });
}

async function attachNetworkToActiveBan(username: string, networkKey: string, ip: string): Promise<void> {
  const banRef = getDb().collection(BANS).doc(username);
  const banSnap = await banRef.get();
  if (!banSnap.exists) return;
  const ban = banSnap.data() as BanRecord;
  const existingNetworks = asStringList(ban.networks);
  const existingIps = asStringList(ban.observedIps);
  if (existingNetworks.includes(networkKey) && (!ip || existingIps.includes(ip))) return;
  const networks = remember(existingNetworks, networkKey);
  const observedIps = remember(existingIps, ip);
  const next: BanRecord = { ...ban, username, networks, observedIps };
  await banRef.set(next);
  await writeNetworkBan(networkKey, next);
}

/**
 * Record this login/play request and decide if the account may play.
 * Expired temporal bans are removed here so the account unbans itself.
 */
export async function enforcePlayAccess(
  username: string,
  context: functions.https.CallableContext,
): Promise<PlayAccessDecision> {
  const now = Date.now();
  const { ip, networkKey } = requestNetwork(context);
  const userSnap = await getDb().collection(USERS).doc(username).get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  const isAdmin = userSnap.data()?.isAdmin === true;

  await recordNetwork(username, ip, networkKey);

  const banSnap = await getDb().collection(BANS).doc(username).get();
  if (banSnap.exists) {
    const ban = banSnap.data() as BanRecord;
    if (!isBanActive(ban, now)) {
      await clearBan(username);
    } else {
      if (networkKey) await attachNetworkToActiveBan(username, networkKey, ip);
      await setPlayLease(username, 0, networkKey);
      return blockedDecision(ban);
    }
  }

  if (networkKey && !isAdmin) {
    const networkBan = await activeNetworkBan(networkKey, now);
    if (networkBan) {
      await setPlayLease(username, 0, networkKey);
      return networkBan;
    }
  }

  await setPlayLease(username, now + PLAY_LEASE_MS, networkKey);
  return CLEAR;
}

export async function assertCanPlay(
  username: string,
  context: functions.https.CallableContext,
): Promise<void> {
  const decision = await enforcePlayAccess(username, context);
  if (decision.banned) {
    throw new functions.https.HttpsError('permission-denied', decision.message);
  }
}

/** Score submit has no password, so it checks bans without recording a new network. */
export async function assertScoreNotBanned(
  username: string | null,
  context: functions.https.CallableContext,
): Promise<void> {
  const now = Date.now();
  if (username) {
    const banSnap = await getDb().collection(BANS).doc(username).get();
    if (banSnap.exists && isBanActive(banSnap.data() as BanRecord, now)) {
      throw new functions.https.HttpsError('permission-denied', formatBanMessage(String(banSnap.data()?.reason ?? '')));
    }
    const userSnap = await getDb().collection(USERS).doc(username).get();
    if (userSnap.data()?.isAdmin === true) return;
  }
  await assertAnonymousNetworkClear(context);
}

export async function assertAnonymousNetworkClear(context: functions.https.CallableContext): Promise<void> {
  const { networkKey } = requestNetwork(context);
  if (!networkKey) return;
  const networkBan = await activeNetworkBan(networkKey, Date.now());
  if (networkBan) {
    throw new functions.https.HttpsError('permission-denied', networkBan.message);
  }
}

export async function checkPlayAccessAccount(
  data: { username?: unknown; password?: unknown } | undefined,
  context: functions.https.CallableContext,
): Promise<PlayAccessDecision> {
  const username = typeof data?.username === 'string' ? data.username : '';
  const password = typeof data?.password === 'string' ? data.password : '';
  if (!username || !password) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing username or password');
  }
  const user = await loadUser(username, password);
  return enforcePlayAccess(user.id, context);
}

export async function banUserAccount(
  data: {
    adminUsername?: unknown;
    adminPassword?: unknown;
    username?: unknown;
    reason?: unknown;
    permanent?: unknown;
    endsAtMs?: unknown;
  } | undefined,
  _context: functions.https.CallableContext,
): Promise<{ success: true; username: string; permanent: boolean; endsAtMs: number | null; networks: string[] }> {
  const adminId = await requireAdmin(
    typeof data?.adminUsername === 'string' ? data.adminUsername : '',
    typeof data?.adminPassword === 'string' ? data.adminPassword : '',
  );
  const targetInput = typeof data?.username === 'string' ? data.username : '';
  const target = await resolveUserDocId(targetInput);
  if (!target) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  const reason = sanitizeBanReason(data?.reason);
  if (!reason) {
    throw new functions.https.HttpsError('invalid-argument', 'A ban reason is required');
  }

  const permanent = data?.permanent !== false;
  const now = Date.now();
  // 0 means "no end" so security rules can compare a number. Null would throw.
  let endsAtMs = 0;
  if (!permanent) {
    const parsed = typeof data?.endsAtMs === 'number' ? data.endsAtMs : Number(data?.endsAtMs);
    if (!Number.isFinite(parsed) || parsed <= now) {
      throw new functions.https.HttpsError('invalid-argument', 'Pick a future date for a temporal ban');
    }
    endsAtMs = parsed;
  }

  const known = await getDb().collection(USER_NETWORKS).doc(target).get();
  const networks = asStringList(known.data()?.networks).slice(-MAX_RECORDED_NETWORKS);
  const observedIps = asStringList(known.data()?.observedIps).slice(-MAX_RECORDED_NETWORKS);
  const previous = await getDb().collection(BANS).doc(target).get();
  const previousNetworks = previous.exists ? asStringList(previous.data()?.networks) : [];

  const ban: BanRecord = {
    username: target,
    reason,
    permanent,
    endsAtMs,
    networks,
    observedIps,
    bannedBy: adminId,
    createdAtMs: now,
  };

  await getDb().collection(BANS).doc(target).set(ban);
  await getDb().collection(BAN_STATUS).doc(target).set({
    reason,
    permanent,
    endsAtMs,
  });
  await setPlayLease(target, 0);

  for (const networkKey of networks) {
    await writeNetworkBan(networkKey, ban);
  }
  for (const networkKey of previousNetworks) {
    if (!networks.includes(networkKey)) await releaseNetwork(networkKey, target);
  }

  console.log(`Banned ${target} permanent=${permanent} networks=${networks.join(',') || 'none'}`);
  return { success: true, username: target, permanent, endsAtMs, networks };
}

export async function unbanUserAccount(
  data: { adminUsername?: unknown; adminPassword?: unknown; username?: unknown } | undefined,
  _context: functions.https.CallableContext,
): Promise<{ success: true; username: string; changed: boolean }> {
  const adminUsername = typeof data?.adminUsername === 'string' ? data.adminUsername : '';
  const adminPassword = typeof data?.adminPassword === 'string' ? data.adminPassword : '';
  await requireAdmin(adminUsername, adminPassword);
  const targetInput = typeof data?.username === 'string' ? data.username : '';
  const target = await resolveUserDocId(targetInput);
  if (!target) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  const changed = await clearBan(target);
  console.log(`Unbanned ${target} changed=${changed}`);
  return { success: true, username: target, changed };
}
