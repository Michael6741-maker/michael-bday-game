/**
 * Signed-in economy mutations. The Admin SDK applies them so Firestore rules
 * can refuse the same fields from the browser.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const USERS = 'users';

const COIN_PRICES: Record<string, number> = {
  angel: 1000,
  devil: 1000,
  lunar: 2000,
  solar: 3500,
  marshmallow: 1000000,
  poop: 5000000,
  'jester-clown': 10000,
  'american-football': 7500,
  'soccer-ball': 7500,
  'golf-ball': 7500,
  baseball: 7500,
  macy: 50000,
};

const GEM_PRICES: Record<string, number> = {
  poop: 200000,
};

const GIFT_BLOCKED = new Set(['default', 'aurora', 'vip', 'deadility', 'rockylity', 'swimtility', 'ancienty', 'fossility']);
const GAMEPASS_GEM_PRICE = 25000;
const AURORA_GOAL = 12;
const CRAFT_MS = 30 * 60 * 1000;
const FOSSIL_TYPES = ['amber', 'bone', 'shell', 'claw', 'fern'];
const RECIPES: Record<string, string> = {
  'amber+amber': 'deadility',
  'amber+shell': 'rockylity',
  'bone+fern': 'swimtility',
  'bone+claw': 'ancienty',
  'amber+fern': 'fossility',
};

const SEASON_BALLS: Record<string, string> = {
  'april-2026': 'april-radioactive-2026',
  'may-2026': 'may-pokeball-2026',
  'june-2026': 'june-yinyang-2026',
  'july-2026': 'july-basketball-2026',
};
const SEASON_PREMIUM_COST = 15000;
const PRO_PASS_ID = 'pro-pass-june-sept-2026';
const PRO_PASS_START = Date.UTC(2026, 5, 9, 0, 0, 0, 0);
const PRO_PASS_END = Date.UTC(2026, 8, 30, 23, 59, 59, 999);
const PRO_PASS_PREMIUM_COST = 50000;
const PRO_BALLS: Record<number, string> = {
  90: 'pro-bane-oceans-2026',
  95: 'pro-bane-dead-2026',
  100: 'pro-bane-thorns-2026',
};

type Doc = FirebaseFirestore.DocumentData;
type Ref = FirebaseFirestore.DocumentReference;

function fail(code: functions.https.FunctionsErrorCode, message: string): never {
  throw new functions.https.HttpsError(code, message);
}

function requireUid(context: functions.https.CallableContext): string {
  if (!context.auth?.uid) fail('unauthenticated', 'Sign in to continue');
  return context.auth.uid;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function nums(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item));
}

function publicUser(id: string, data: Doc): Doc {
  const copy: Doc = { ...data, username: typeof data.username === 'string' ? data.username : id };
  delete copy.password;
  return copy;
}

function userRef(uid: string): Ref {
  return db.collection(USERS).doc(uid);
}

async function loadUser(uid: string): Promise<Doc> {
  const snap = await userRef(uid).get();
  if (!snap.exists) fail('not-found', 'User not found');
  return snap.data() as Doc;
}

function currentSeasonId(now = new Date()): string {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  return `${months[now.getUTCMonth()]}-${now.getUTCFullYear()}`;
}

function proPassActive(now = Date.now()): boolean {
  return now >= PRO_PASS_START && now <= PRO_PASS_END;
}

function giftGemPrice(ballId: string): number | null {
  if (GIFT_BLOCKED.has(ballId)) return null;
  if (ballId === 'poop') return 200000;
  const coins = COIN_PRICES[ballId];
  if (!coins || coins <= 0) return null;
  return Math.floor(coins / 2);
}

function seasonReward(tier: number, track: 'free' | 'premium', seasonId: string): { type: string; amount?: number; ballId?: string } {
  if (track === 'free') {
    return tier % 6 === 0 ? { type: 'extraBall', amount: 1 } : { type: 'coins', amount: 200 };
  }
  if (tier === 25) return { type: 'ball', ballId: SEASON_BALLS[seasonId] };
  if (tier % 3 === 0) return { type: 'extraBall', amount: 1 };
  return { type: 'coins', amount: 200 };
}

function proReward(tier: number, track: 'free' | 'premium'): { type: string; amount?: number; ballId?: string } {
  if (track === 'free') {
    return tier % 6 === 0 ? { type: 'extraBall', amount: 1 } : { type: 'coins', amount: 200 };
  }
  if (PRO_BALLS[tier]) return { type: 'ball', ballId: PRO_BALLS[tier] };
  if (tier % 3 === 0) return { type: 'extraBall', amount: 1 };
  return { type: 'coins', amount: 200 };
}

function applyReward(user: Doc, reward: { type: string; amount?: number; ballId?: string }): Doc {
  const next = { ...user };
  if (reward.type === 'coins') next.totalCoins = num(user.totalCoins) + (reward.amount ?? 0);
  if (reward.type === 'extraBall') next.extraBalls = num(user.extraBalls) + (reward.amount ?? 1);
  if (reward.type === 'ball' && reward.ballId && !strings(user.ownedBalls).includes(reward.ballId)) {
    next.ownedBalls = [...strings(user.ownedBalls), reward.ballId];
  }
  return next;
}

async function recordRun(uid: string, data: Doc): Promise<Doc> {
  const meters = Math.floor(num(data.meters));
  const coins = Math.floor(num(data.coins));
  const gems = Math.floor(num(data.gems));
  if (meters < 0 || meters > 200000 || coins < 0 || gems < 0) fail('invalid-argument', 'Invalid run rewards');
  const user = await loadUser(uid);
  const doubleCash = user.gamepasses?.doubleCash === true;
  const maxCoins = Math.floor(meters / 50) * (doubleCash ? 40 : 20);
  const maxGems = Math.floor(meters / 100) * 20;
  if (coins > maxCoins || gems > maxGems) fail('invalid-argument', 'Rewards exceed the run');

  const seasonId = currentSeasonId();
  const previous = user.seasonData && user.seasonData.seasonId === seasonId ? user.seasonData : null;
  const seasonData = previous
    ? { ...previous, meters: num(previous.meters) + meters }
    : { seasonId, meters, premiumUnlocked: false, claimedFree: [], claimedPremium: [] };

  const updates: Doc = {
    totalMeters: num(user.totalMeters) + meters,
    totalCoins: num(user.totalCoins) + coins,
    totalGems: num(user.totalGems) + gems,
    seasonData,
  };

  const active = proPassActive();
  const existingPass = user.proPassData;
  if (active) {
    updates.proPassData = existingPass && existingPass.passId === PRO_PASS_ID
      ? { ...existingPass, meters: num(existingPass.meters) + meters }
      : { passId: PRO_PASS_ID, meters, premiumUnlocked: false, claimedFree: [], claimedPremium: [] };
  }

  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }) };
}

async function purchaseBall(uid: string, data: Doc): Promise<Doc> {
  const ballId = String(data.ballId ?? '');
  const user = await loadUser(uid);
  const owned = strings(user.ownedBalls);
  if (!ballId || owned.includes(ballId)) fail('already-exists', 'Ball already owned');

  let price = 0;
  if (ballId === 'aurora') {
    if (user.auroraBallUnlocked !== true && num(user.auroraShards) < AURORA_GOAL) {
      fail('failed-precondition', 'Collect all Aurora Shards first');
    }
  } else if (ballId === 'vip') {
    if (user.gamepasses?.vip !== true) fail('failed-precondition', 'Purchase the VIP gamepass first');
  } else if (ballId in COIN_PRICES) {
    price = COIN_PRICES[ballId];
  } else {
    fail('invalid-argument', 'Unknown ball');
  }
  if (num(user.totalCoins) < price) fail('failed-precondition', 'Not enough coins');
  const updates = { totalCoins: num(user.totalCoins) - price, ownedBalls: admin.firestore.FieldValue.arrayUnion(ballId) };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, totalCoins: num(user.totalCoins) - price, ownedBalls: [...owned, ballId] }) };
}

async function purchaseBallWithGems(uid: string, data: Doc): Promise<Doc> {
  const ballId = String(data.ballId ?? '');
  const price = GEM_PRICES[ballId];
  if (!price) fail('invalid-argument', 'This ball cannot be purchased with gems');
  const user = await loadUser(uid);
  const owned = strings(user.ownedBalls);
  if (owned.includes(ballId)) fail('already-exists', 'Ball already owned');
  if (num(user.totalGems) < price) fail('failed-precondition', 'Not enough gems');
  const updates = { totalGems: num(user.totalGems) - price, ownedBalls: admin.firestore.FieldValue.arrayUnion(ballId) };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, totalGems: num(user.totalGems) - price, ownedBalls: [...owned, ballId] }) };
}

async function purchaseOffer(uid: string, data: Doc): Promise<Doc> {
  const offerId = String(data.offerId ?? '');
  const offerSnap = await db.collection('shopOffers').doc(offerId).get();
  if (!offerSnap.exists) fail('not-found', 'Offer no longer exists');
  const offer = offerSnap.data() as Doc;
  const now = Date.now();
  if (offer.itemType !== 'ball') fail('invalid-argument', 'Unsupported offer item');
  if (now < num(offer.startAtMs) || now >= num(offer.endsAtMs)) fail('failed-precondition', 'Offer expired');
  const ballId = String(offer.itemId ?? '');
  const price = Math.floor(num(offer.price));
  if (!ballId || price < 0) fail('invalid-argument', 'Invalid offer');
  const user = await loadUser(uid);
  const owned = strings(user.ownedBalls);
  if (owned.includes(ballId)) fail('already-exists', 'Ball already owned');
  if (num(user.totalCoins) < price) fail('failed-precondition', 'Not enough coins');
  const updates = { totalCoins: num(user.totalCoins) - price, ownedBalls: admin.firestore.FieldValue.arrayUnion(ballId) };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, totalCoins: num(user.totalCoins) - price, ownedBalls: [...owned, ballId] }) };
}

async function purchaseGamepass(uid: string, data: Doc): Promise<Doc> {
  const passId = String(data.passId ?? '');
  if (passId !== 'vip' && passId !== 'doubleCash') fail('invalid-argument', 'Unknown gamepass');
  const user = await loadUser(uid);
  const passes = { ...(user.gamepasses ?? {}) };
  if (passes[passId] === true) fail('already-exists', 'Gamepass already owned');
  if (num(user.totalGems) < GAMEPASS_GEM_PRICE) fail('failed-precondition', 'Not enough gems');
  passes[passId] = true;
  const owned = strings(user.ownedBalls);
  const updates: Doc = {
    totalGems: num(user.totalGems) - GAMEPASS_GEM_PRICE,
    gamepasses: passes,
  };
  if (passId === 'vip' && !owned.includes('vip')) updates.ownedBalls = admin.firestore.FieldValue.arrayUnion('vip');
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates, ownedBalls: passId === 'vip' && !owned.includes('vip') ? [...owned, 'vip'] : owned }) };
}

async function useExtraBall(uid: string): Promise<Doc> {
  const user = await loadUser(uid);
  const current = num(user.extraBalls);
  if (current <= 0) fail('failed-precondition', 'No extra balls');
  const updates = { extraBalls: current - 1 };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }) };
}

async function awardAuroraShard(uid: string): Promise<Doc> {
  const user = await loadUser(uid);
  const current = Math.min(num(user.auroraShards), AURORA_GOAL);
  if (user.auroraBallUnlocked === true || current >= AURORA_GOAL) {
    const updates = { auroraShards: AURORA_GOAL, auroraBallUnlocked: true };
    await userRef(uid).update(updates);
    return { user: publicUser(uid, { ...user, ...updates }), awarded: false, auroraShards: AURORA_GOAL, auroraBallUnlocked: true };
  }
  const next = Math.min(current + 1, AURORA_GOAL);
  const unlocked = next >= AURORA_GOAL;
  const updates = { auroraShards: next, auroraBallUnlocked: unlocked };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }), awarded: true, auroraShards: next, auroraBallUnlocked: unlocked };
}

async function awardFossil(uid: string, data: Doc): Promise<Doc> {
  const type = String(data.type ?? '');
  if (!FOSSIL_TYPES.includes(type)) fail('invalid-argument', 'Unknown fossil');
  const user = await loadUser(uid);
  const inventory = { ...(user.fossilInventory ?? {}) };
  inventory[type] = num(inventory[type]) + 1;
  await userRef(uid).update({ fossilInventory: inventory });
  return { user: publicUser(uid, { ...user, fossilInventory: inventory }), type, inventory };
}

function recipeFor(a: string, b: string): string | null {
  return RECIPES[[a, b].sort().join('+')] ?? null;
}

async function startCraft(uid: string, data: Doc): Promise<Doc> {
  const fossilA = String(data.fossilA ?? '');
  const fossilB = String(data.fossilB ?? '');
  const result = recipeFor(fossilA, fossilB);
  if (!result) fail('invalid-argument', 'Invalid fossil recipe');
  const user = await loadUser(uid);
  if (user.fossilCraftJob) fail('failed-precondition', 'A fossil craft is already in progress');
  const inventory = { ...(user.fossilInventory ?? {}) };
  const need: Record<string, number> = {};
  need[fossilA] = (need[fossilA] ?? 0) + 1;
  need[fossilB] = (need[fossilB] ?? 0) + 1;
  for (const [type, count] of Object.entries(need)) {
    if (num(inventory[type]) < count) fail('failed-precondition', 'Not enough fossils for this recipe');
  }
  inventory[fossilA] = num(inventory[fossilA]) - 1;
  inventory[fossilB] = num(inventory[fossilB]) - 1;
  const fossilCraftJob = {
    fossilA,
    fossilB,
    resultBallId: result,
    startedAtMs: Date.now(),
    endsAtMs: Date.now() + CRAFT_MS,
  };
  await userRef(uid).update({ fossilInventory: inventory, fossilCraftJob });
  return { user: publicUser(uid, { ...user, fossilInventory: inventory, fossilCraftJob }) };
}

async function claimCraft(uid: string): Promise<Doc> {
  const user = await loadUser(uid);
  const job = user.fossilCraftJob as Doc | null | undefined;
  if (!job) fail('failed-precondition', 'No fossil craft to claim');
  if (Date.now() < num(job.endsAtMs)) fail('failed-precondition', 'Craft is not finished yet');
  const owned = strings(user.ownedBalls);
  const ballId = String(job.resultBallId ?? '');
  const updates: Doc = { fossilCraftJob: null };
  if (ballId && !owned.includes(ballId)) updates.ownedBalls = [...owned, ballId];
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }) };
}

async function claimSeason(uid: string, data: Doc): Promise<Doc> {
  const seasonId = String(data.seasonId ?? '');
  const track = data.track === 'premium' ? 'premium' : 'free';
  const levelIndex = Math.floor(num(data.levelIndex, -1));
  if (seasonId !== currentSeasonId()) fail('failed-precondition', 'Season has ended');
  if (!SEASON_BALLS[seasonId]) fail('invalid-argument', 'Unknown season');
  if (levelIndex < 0 || levelIndex >= 25) fail('invalid-argument', 'Invalid level');
  const user = await loadUser(uid);
  const sd = user.seasonData;
  if (!sd || sd.seasonId !== seasonId) fail('failed-precondition', 'Season data mismatch');
  const tier = levelIndex + 1;
  if (num(sd.meters) < tier * 1000) fail('failed-precondition', 'Threshold not reached');
  const claimed = nums(track === 'free' ? sd.claimedFree : sd.claimedPremium);
  if (claimed.includes(levelIndex)) fail('already-exists', 'Already claimed');
  if (track === 'premium' && sd.premiumUnlocked !== true) fail('failed-precondition', 'Premium not unlocked');
  const reward = seasonReward(tier, track, seasonId);
  const nextSeason = {
    ...sd,
    claimedFree: track === 'free' ? [...nums(sd.claimedFree), levelIndex] : nums(sd.claimedFree),
    claimedPremium: track === 'premium' ? [...nums(sd.claimedPremium), levelIndex] : nums(sd.claimedPremium),
  };
  const updated = applyReward({ ...user, seasonData: nextSeason }, reward);
  const updates = {
    seasonData: updated.seasonData,
    totalCoins: updated.totalCoins,
    extraBalls: updated.extraBalls,
    ownedBalls: updated.ownedBalls,
  };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }) };
}

async function buySeasonPremium(uid: string, data: Doc): Promise<Doc> {
  const seasonId = String(data.seasonId ?? '');
  if (seasonId !== currentSeasonId() || !SEASON_BALLS[seasonId]) fail('failed-precondition', 'Season has ended');
  const user = await loadUser(uid);
  if (num(user.totalCoins) < SEASON_PREMIUM_COST) fail('failed-precondition', 'Not enough coins');
  const sd = user.seasonData && user.seasonData.seasonId === seasonId
    ? { ...user.seasonData, premiumUnlocked: true }
    : { seasonId, meters: 0, premiumUnlocked: true, claimedFree: [], claimedPremium: [] };
  const updates = { totalCoins: num(user.totalCoins) - SEASON_PREMIUM_COST, seasonData: sd };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }) };
}

async function claimProPass(uid: string, data: Doc): Promise<Doc> {
  const passId = String(data.passId ?? '');
  const track = data.track === 'premium' ? 'premium' : 'free';
  const levelIndex = Math.floor(num(data.levelIndex, -1));
  if (passId !== PRO_PASS_ID) fail('invalid-argument', 'Unknown Pro Pass');
  if (levelIndex < 0 || levelIndex >= 100) fail('invalid-argument', 'Invalid level');
  const user = await loadUser(uid);
  const pp = user.proPassData;
  if (!pp || pp.passId !== passId) fail('failed-precondition', 'Pro Pass data mismatch');
  const tier = levelIndex + 1;
  if (num(pp.meters) < tier * 2500) fail('failed-precondition', 'Threshold not reached');
  const claimed = nums(track === 'free' ? pp.claimedFree : pp.claimedPremium);
  if (claimed.includes(levelIndex)) fail('already-exists', 'Already claimed');
  if (track === 'premium' && pp.premiumUnlocked !== true) fail('failed-precondition', 'Premium not unlocked');
  const nextPass = {
    ...pp,
    claimedFree: track === 'free' ? [...nums(pp.claimedFree), levelIndex] : nums(pp.claimedFree),
    claimedPremium: track === 'premium' ? [...nums(pp.claimedPremium), levelIndex] : nums(pp.claimedPremium),
  };
  const updated = applyReward({ ...user, proPassData: nextPass }, proReward(tier, track));
  const updates = {
    proPassData: updated.proPassData,
    totalCoins: updated.totalCoins,
    extraBalls: updated.extraBalls,
    ownedBalls: updated.ownedBalls,
  };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }) };
}

async function buyProPassPremium(uid: string, data: Doc): Promise<Doc> {
  const passId = String(data.passId ?? '');
  if (passId !== PRO_PASS_ID) fail('invalid-argument', 'Unknown Pro Pass');
  if (!proPassActive()) fail('failed-precondition', 'Pro Pass has ended');
  const user = await loadUser(uid);
  if (num(user.totalCoins) < PRO_PASS_PREMIUM_COST) fail('failed-precondition', 'Not enough coins');
  const pp = user.proPassData && user.proPassData.passId === passId
    ? { ...user.proPassData, premiumUnlocked: true }
    : { passId, meters: 0, premiumUnlocked: true, claimedFree: [], claimedPremium: [] };
  const updates = { totalCoins: num(user.totalCoins) - PRO_PASS_PREMIUM_COST, proPassData: pp };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }) };
}

async function purchaseAvatarItem(uid: string, data: Doc): Promise<Doc> {
  const itemId = String(data.itemId ?? '');
  if (!itemId) fail('invalid-argument', 'Missing item');
  const user = await loadUser(uid);
  const owned = strings(user.ownedAvatarItems);
  if (owned.includes(itemId)) fail('already-exists', 'Already owned');
  let price = 0;
  let stockRef: Ref | null = null;
  let nextStock: number | null = null;
  if (!itemId.startsWith('starter-')) {
    const itemSnap = await db.collection('avatarItems').doc(itemId).get();
    if (!itemSnap.exists) fail('not-found', 'Item not found');
    const item = itemSnap.data() as Doc;
    if (item.onSale === false) fail('failed-precondition', 'Item is off sale');
    if (item.stock !== null && item.stock !== undefined && num(item.stock) <= 0) fail('failed-precondition', 'Sold out');
    price = Math.max(0, Math.floor(num(item.gemPrice)));
    if (typeof item.stock === 'number') {
      stockRef = itemSnap.ref;
      nextStock = item.stock - 1;
    }
  }
  if (num(user.totalGems) < price) fail('failed-precondition', 'Not enough gems');
  if (stockRef && nextStock !== null) {
    await stockRef.update({ stock: nextStock, updatedAtMs: Date.now() });
  }
  const updates = { totalGems: num(user.totalGems) - price, ownedAvatarItems: [...owned, itemId] };
  await userRef(uid).update(updates);
  return { user: publicUser(uid, { ...user, ...updates }) };
}

async function giftItem(uid: string, data: Doc): Promise<Doc> {
  const toUsername = String(data.toUsername ?? '').trim();
  const itemType = data.itemType === 'gamepass' ? 'gamepass' : 'ball';
  const itemId = String(data.itemId ?? '');
  const itemLabel = String(data.itemLabel ?? itemId).slice(0, 80);
  if (!toUsername || !itemId) fail('invalid-argument', 'Missing gift');
  if (toUsername === uid) fail('invalid-argument', 'You cannot gift items to yourself');
  const recipientSnap = await userRef(toUsername).get();
  if (!recipientSnap.exists) fail('not-found', 'Player not found');
  const gifter = await loadUser(uid);
  const recipient = recipientSnap.data() as Doc;
  let cost = 0;
  if (itemType === 'ball') {
    const canonical = giftGemPrice(itemId);
    if (canonical === null) fail('invalid-argument', 'This ball cannot be gifted');
    if (strings(recipient.ownedBalls).includes(itemId)) fail('already-exists', 'Player already has Item');
    cost = canonical;
  } else {
    if (itemId !== 'vip' && itemId !== 'doubleCash') fail('invalid-argument', 'Unknown gamepass');
    const passes = recipient.gamepasses ?? {};
    if (passes[itemId] === true) fail('already-exists', 'Player already has Item');
    cost = GAMEPASS_GEM_PRICE;
  }
  if (num(gifter.totalGems) < cost) fail('failed-precondition', 'Not enough gems');

  const giftId = `gift-${Date.now()}`;
  const pendingGift = { id: giftId, fromUsername: uid, itemType, itemId, itemLabel, createdAtMs: Date.now() };
  const recipientUpdates: Doc = { pendingGifts: [...(Array.isArray(recipient.pendingGifts) ? recipient.pendingGifts : []), pendingGift] };
  if (itemType === 'ball') {
    recipientUpdates.ownedBalls = [...strings(recipient.ownedBalls), itemId];
  } else {
    recipientUpdates.gamepasses = { ...(recipient.gamepasses ?? {}), [itemId]: true };
    if (itemId === 'vip' && !strings(recipient.ownedBalls).includes('vip')) {
      recipientUpdates.ownedBalls = [...strings(recipient.ownedBalls), 'vip'];
    }
  }
  const batch = db.batch();
  batch.update(userRef(uid), { totalGems: num(gifter.totalGems) - cost });
  batch.update(userRef(toUsername), recipientUpdates);
  const audit = db.collection('giftTransactions').doc();
  batch.set(audit, {
    id: audit.id,
    fromUsername: uid,
    toUsername,
    itemType,
    itemId,
    gemCost: cost,
    createdAtMs: Date.now(),
  });
  await batch.commit();
  return {
    gifter: publicUser(uid, { ...gifter, totalGems: num(gifter.totalGems) - cost }),
    recipientUsername: toUsername,
  };
}

export const applyPlayerEconomy = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const action = String(data?.action ?? '');
  switch (action) {
    case 'recordRun': return recordRun(uid, data ?? {});
    case 'purchaseBall': return purchaseBall(uid, data ?? {});
    case 'purchaseBallWithGems': return purchaseBallWithGems(uid, data ?? {});
    case 'purchaseOffer': return purchaseOffer(uid, data ?? {});
    case 'purchaseGamepass': return purchaseGamepass(uid, data ?? {});
    case 'useExtraBall': return useExtraBall(uid);
    case 'awardAuroraShard': return awardAuroraShard(uid);
    case 'awardFossil': return awardFossil(uid, data ?? {});
    case 'startCraft': return startCraft(uid, data ?? {});
    case 'claimCraft': return claimCraft(uid);
    case 'claimSeason': return claimSeason(uid, data ?? {});
    case 'buySeasonPremium': return buySeasonPremium(uid, data ?? {});
    case 'claimProPass': return claimProPass(uid, data ?? {});
    case 'buyProPassPremium': return buyProPassPremium(uid, data ?? {});
    case 'purchaseAvatarItem': return purchaseAvatarItem(uid, data ?? {});
    case 'gift': return giftItem(uid, data ?? {});
    default: fail('invalid-argument', 'Unknown action');
  }
});

export const castPollVote = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const pollId = String(data?.pollId ?? '');
  const optionIndex = Math.floor(num(data?.optionIndex, -1));
  if (!pollId || optionIndex < 0) fail('invalid-argument', 'Missing vote');
  const pollRef = db.collection('polls').doc(pollId);
  const answerRef = pollRef.collection('answers').doc(uid);
  await db.runTransaction(async (tx) => {
    const [pollSnap, answerSnap] = await Promise.all([tx.get(pollRef), tx.get(answerRef)]);
    if (!pollSnap.exists) fail('not-found', 'Poll not found');
    const poll = pollSnap.data() as Doc;
    if (poll.active !== true) fail('failed-precondition', 'Poll is closed');
    const options = Array.isArray(poll.options) ? poll.options : [];
    if (optionIndex >= options.length) fail('invalid-argument', 'Invalid option');
    if (answerSnap.exists) fail('already-exists', 'Already answered');
    tx.set(answerRef, { optionIndex, answeredAtMs: Date.now() });
    tx.update(pollRef, { [`counts.${optionIndex}`]: admin.firestore.FieldValue.increment(1) });
  });
  return { success: true };
});
