import type { BallType } from './types';

/**
 * Retired season-pass balls. They stay in the game for players who already own
 * them, and admins can still put them in a shop offer. The season pass no
 * longer grants them.
 */
export const LEGACY_SEASON_BALLS: BallType[] = [
  {
    id: 'april-radioactive-2026',
    name: 'Radioactive',
    price: 0,
    color: '#39FF14',
    strokeColor: '#006400',
    isDefault: false,
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/2622.svg',
    description: 'Retired season ball. Only available again in a shop offer.',
  },
  {
    id: 'may-pokeball-2026',
    name: 'Pok\u00e9ball',
    price: 0,
    color: '#EE1515',
    strokeColor: '#222222',
    isDefault: false,
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/53/Pok%C3%A9_Ball_icon.svg',
    description: 'Retired season ball. Only available again in a shop offer.',
  },
  {
    id: 'june-yinyang-2026',
    name: 'Yin Yang',
    price: 0,
    color: '#FFFFFF',
    strokeColor: '#000000',
    isDefault: false,
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/262f.svg',
    description: 'Retired season ball. Only available again in a shop offer.',
  },
  {
    id: 'july-basketball-2026',
    name: 'Basketball',
    price: 0,
    color: '#f97316',
    strokeColor: '#111827',
    isDefault: false,
    imageUrl: '/basketball-ball.svg',
    description: 'Retired season ball. Only available again in a shop offer.',
  },
];

/**
 * Retired Pro Pass balls. The pass is gone. Owners keep them, and a shop offer
 * is the only way for anyone else to get one.
 */
export const PRO_PASS_BALLS: BallType[] = [
  {
    id: 'pro-bane-oceans-2026',
    name: 'Bane Of Oceans',
    price: 0,
    color: '#1e40af',
    strokeColor: '#1e3a8a',
    isDefault: false,
    imageUrl: '/pro-bane-oceans-ball.svg',
    imageCover: true,
    description: 'Retired Pro Pass ball. Only available again in a shop offer.',
  },
  {
    id: 'pro-bane-dead-2026',
    name: 'Bane Of Dead',
    price: 0,
    color: '#dc2626',
    strokeColor: '#991b1b',
    isDefault: false,
    imageUrl: '/pro-bane-dead-ball.svg',
    imageCover: true,
    description: 'Retired Pro Pass ball. Only available again in a shop offer.',
  },
  {
    id: 'pro-bane-thorns-2026',
    name: 'Bane Of Thorns',
    price: 0,
    color: '#16a34a',
    strokeColor: '#14532d',
    isDefault: false,
    imageUrl: '/pro-bane-thorns-ball.svg',
    imageCover: true,
    description: 'Retired Pro Pass ball. Only available again in a shop offer.',
  },
];

/** Balls that cannot be earned or bought except through a shop offer. */
export const SHOP_OFFER_ONLY_BALLS: BallType[] = [
  ...LEGACY_SEASON_BALLS,
  ...PRO_PASS_BALLS,
];

const SHOP_OFFER_ONLY_IDS = new Set(SHOP_OFFER_ONLY_BALLS.map((ball) => ball.id));

export function isShopOfferOnlyBall(ballId: string): boolean {
  return SHOP_OFFER_ONLY_IDS.has(ballId);
}

export function getLegacySeasonBallById(ballId: string): BallType | null {
  return LEGACY_SEASON_BALLS.find((ball) => ball.id === ballId) ?? null;
}

export function getProPassBallById(ballId: string): BallType | null {
  return PRO_PASS_BALLS.find((ball) => ball.id === ballId) ?? null;
}

export function getOwnedSeasonBalls(ownedBalls: string[]): BallType[] {
  return LEGACY_SEASON_BALLS.filter((ball) => ownedBalls.includes(ball.id));
}

export function getOwnedProPassBalls(ownedBalls: string[]): BallType[] {
  return PRO_PASS_BALLS.filter((ball) => ownedBalls.includes(ball.id));
}
