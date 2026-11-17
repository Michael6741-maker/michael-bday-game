import { getSeasonAvatarItemById, SEASON_OUTFITS, type SeasonOutfit } from './avatarItems';

/**
 * Reward granted at a season achievement level.
 * Season balls are not a reward. The tier-25 premium prize is avatar items.
 */
export interface SeasonReward {
  type: 'coins' | 'extraBall' | 'avatarItem';
  amount?: number;
  avatarItemId?: string;
  avatarItemIds?: string[];
  /** Short label for a multi-item prize, e.g. "Frost Outfit". */
  label?: string;
}

/**
 * A single achievement level within a season.
 */
export interface SeasonLevel {
  meterThreshold: number;
  freeReward: SeasonReward;
  premiumReward: SeasonReward;
}

/**
 * Full configuration for one numbered season (one calendar month).
 * Season 1 is November 2026. Each later season is the next month.
 */
export interface SeasonConfig {
  id: string;             // e.g. "season-1"
  displayName: string;    // e.g. "Season 1"
  month: number;          // 1-indexed calendar month this season occupies
  year: number;
  premiumCost: number;    // coins to unlock the top row
  levels: SeasonLevel[];  // exactly 25 levels
  emoji: string;
  accentColor: string;
  outfitLabel: string;
  avatarItemIds: string[];
  featuredAvatarItemId: string;
}

// ---------------------------------------------------------------------------
// Season definitions
// ---------------------------------------------------------------------------

// 25-tier season pass.
//   Free track (bottom row):     1 revive ball every 6 tiers (6, 12, 18, 24); otherwise 200 coins.
//   Premium track (top row):     1 revive ball every 3 tiers (3, 6, 9, 12, 15, 18, 21, 24);
//                                 the season avatar outfit at tier 25; otherwise 200 coins.
//   Thresholds: 1000m per tier (1k–25k).
//   Top row unlock: 15,000 coins.
const TOTAL_TIERS = 25;
const METERS_PER_TIER = 1000;
const COIN_REWARD = 200;
const FREE_REVIVE_EVERY = 6;
const PREMIUM_REVIVE_EVERY = 3;
const PREMIUM_COST = 15000;

/** Season 1 occupies November 2026. Season 2 is December 2026, and so on. */
const SEASON_1_YEAR = 2026;
const SEASON_1_MONTH = 11;

const STANDARD_LEVELS = (avatarItemIds: string[], outfitLabel: string): SeasonLevel[] => {
  const levels: SeasonLevel[] = [];
  for (let i = 1; i <= TOTAL_TIERS; i++) {
    const freeReward: SeasonReward =
      i % FREE_REVIVE_EVERY === 0
        ? { type: 'extraBall', amount: 1 }
        : { type: 'coins', amount: COIN_REWARD };

    let premiumReward: SeasonReward;
    if (i === TOTAL_TIERS) {
      premiumReward = { type: 'avatarItem', avatarItemIds, label: outfitLabel };
    } else if (i % PREMIUM_REVIVE_EVERY === 0) {
      premiumReward = { type: 'extraBall', amount: 1 };
    } else {
      premiumReward = { type: 'coins', amount: COIN_REWARD };
    }

    levels.push({
      meterThreshold: i * METERS_PER_TIER,
      freeReward,
      premiumReward,
    });
  }
  return levels;
};

function buildSeason(outfit: SeasonOutfit): SeasonConfig {
  const index = outfit.seasonNumber - 1;
  const monthIndex = SEASON_1_MONTH - 1 + index;
  const year = SEASON_1_YEAR + Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;

  return {
    id: `season-${outfit.seasonNumber}`,
    displayName: `Season ${outfit.seasonNumber}`,
    month,
    year,
    premiumCost: PREMIUM_COST,
    emoji: outfit.emoji,
    accentColor: outfit.accentColor,
    outfitLabel: outfit.label,
    avatarItemIds: outfit.itemIds,
    featuredAvatarItemId: outfit.featuredItemId,
    levels: STANDARD_LEVELS(outfit.itemIds, outfit.label),
  };
}

export const SEASON_CONFIGS: SeasonConfig[] = SEASON_OUTFITS.map(buildSeason);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 1-based season number for a date. November 2026 is 1. Earlier dates are below 1. */
export function getSeasonNumber(now: Date = new Date()): number {
  const months =
    (now.getFullYear() - SEASON_1_YEAR) * 12 + (now.getMonth() + 1 - SEASON_1_MONTH);
  return months + 1;
}

/** Season id like "season-1" for the calendar month containing `now`. */
export function getCurrentSeasonId(now: Date = new Date()): string {
  return `season-${getSeasonNumber(now)}`;
}

/** Look up a season config by id. */
export function getSeasonConfig(seasonId: string): SeasonConfig | null {
  return SEASON_CONFIGS.find((s) => s.id === seasonId) ?? null;
}

/** Shorthand: config for the current calendar month, if one is defined. */
export function getCurrentSeasonConfig(now: Date = new Date()): SeasonConfig | null {
  return getSeasonConfig(getCurrentSeasonId(now));
}

/** Days remaining in the season (including today). */
export function getDaysRemaining(seasonId: string, now: Date = new Date()): number {
  const config = getSeasonConfig(seasonId);
  if (!config) return 0;

  const seasonEnd = new Date(config.year, config.month, 1);
  const msPerDay = 1000 * 60 * 60 * 24;
  const remaining = Math.ceil((seasonEnd.getTime() - now.getTime()) / msPerDay);
  return Math.max(0, remaining);
}

/** Detailed time remaining for an already-loaded season config. */
export function getTimeRemainingForConfig(
  config: SeasonConfig,
  now: Date = new Date(),
): { days: number; hours: number; minutes: number } {
  const seasonEnd = new Date(config.year, config.month, 1);
  const diff = Math.max(0, seasonEnd.getTime() - now.getTime());
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return { days, hours, minutes };
}

/** Detailed time remaining: days, hours, minutes. */
export function getTimeRemaining(seasonId: string, now: Date = new Date()): { days: number; hours: number; minutes: number } {
  const config = getSeasonConfig(seasonId);
  if (!config) return { days: 0, hours: 0, minutes: 0 };

  return getTimeRemainingForConfig(config, now);
}

/** Avatar item ids granted by a reward, in catalog order. */
export function rewardAvatarItemIds(reward: SeasonReward): string[] {
  const ids = [
    ...(reward.avatarItemIds ?? []),
    ...(reward.avatarItemId ? [reward.avatarItemId] : []),
  ];
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

/** Human-readable label for a reward. */
export function formatReward(reward: SeasonReward): string {
  switch (reward.type) {
    case 'coins':
      return `${reward.amount?.toLocaleString()} coins`;
    case 'extraBall':
      return `${reward.amount ?? 1} extra ball`;
    case 'avatarItem': {
      if (reward.label) return reward.label;
      const names = rewardAvatarItemIds(reward)
        .map((id) => getSeasonAvatarItemById(id)?.name)
        .filter((name): name is string => Boolean(name));
      return names.length > 0 ? names.join(', ') : 'Avatar items';
    }
  }
}

/** Emoji icon for a reward type. */
export function rewardEmoji(reward: SeasonReward): string {
  switch (reward.type) {
    case 'coins': return '🪙';
    case 'extraBall': return '🔮';
    case 'avatarItem': return '👕';
  }
}
