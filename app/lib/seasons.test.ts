/**
 * Season pass restart: Season 1 is November 2026, premium costs 15,000 coins,
 * and the tier-25 prize is avatar items. Retired balls stay shop-offer only.
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEASON_CONFIGS,
  formatReward,
  getCurrentSeasonId,
  getSeasonConfig,
  getSeasonNumber,
} from './seasons';
import {
  LEGACY_SEASON_BALLS,
  PRO_PASS_BALLS,
  getOwnedProPassBalls,
  getOwnedSeasonBalls,
  isShopOfferOnlyBall,
} from './exclusiveBalls';
import { BALL_TYPES, getBallGiftGemPrice, getBallTypeById, getOfferableBallTypes, isBallGiftable } from './ballTypes';
import { SEASON_AVATAR_ITEMS, STARTER_OWNED_ITEM_IDS } from './avatarItems';

describe('season pass restart', () => {
  it('numbers November 2026 as season 1 and each later month as the next season', () => {
    assert.equal(getSeasonNumber(new Date(2026, 10, 17, 12)), 1);
    assert.equal(getCurrentSeasonId(new Date(2026, 10, 30, 23, 59)), 'season-1');
    assert.equal(getCurrentSeasonId(new Date(2026, 11, 1, 0, 0)), 'season-2');
    assert.equal(getCurrentSeasonId(new Date(2027, 0, 15)), 'season-3');
    assert.equal(getCurrentSeasonId(new Date(2027, 1, 1)), 'season-4');
    assert.equal(getSeasonConfig('april-2026'), null);
    assert.equal(getSeasonConfig('season-1')?.displayName, 'Season 1');
  });

  it('keeps the 25-tier rules and a 15,000 coin top row', () => {
    for (const config of SEASON_CONFIGS) {
      assert.equal(config.premiumCost, 15000);
      assert.equal(config.levels.length, 25);
      config.levels.forEach((level, index) => {
        const tier = index + 1;
        assert.equal(level.meterThreshold, tier * 1000);
        if (tier % 6 === 0) {
          assert.deepEqual(level.freeReward, { type: 'extraBall', amount: 1 });
        } else {
          assert.deepEqual(level.freeReward, { type: 'coins', amount: 200 });
        }
        if (tier === 25) {
          assert.equal(level.premiumReward.type, 'avatarItem');
          assert.equal(level.premiumReward.avatarItemIds?.length, 3);
          assert.equal(level.premiumReward.label, config.outfitLabel);
        } else if (tier % 3 === 0) {
          assert.deepEqual(level.premiumReward, { type: 'extraBall', amount: 1 });
        } else {
          assert.deepEqual(level.premiumReward, { type: 'coins', amount: 200 });
        }
      });
    }
  });

  it('grants avatar outfits instead of season or pro pass balls', () => {
    const dumped = JSON.stringify(SEASON_CONFIGS);
    for (const ball of [...LEGACY_SEASON_BALLS, ...PRO_PASS_BALLS]) {
      assert.equal(dumped.includes(ball.id), false);
    }
    const season1 = getSeasonConfig('season-1');
    assert.ok(season1);
    assert.equal(formatReward(season1.levels[24].premiumReward), 'Frost Outfit');
    assert.deepEqual(season1.avatarItemIds, [
      'season-1-frost-shirt',
      'season-1-frost-hair',
      'season-1-frost-pants',
    ]);
  });

  it('keeps season avatar items out of the free starter set and off the shop', () => {
    assert.equal(SEASON_AVATAR_ITEMS.length, 12);
    for (const item of SEASON_AVATAR_ITEMS) {
      assert.equal(item.onSale, false);
      assert.equal(STARTER_OWNED_ITEM_IDS.includes(item.id), false);
      assert.match(item.textureUrl ?? '', /-texture\.png$/);
    }
  });
});

describe('retired exclusive balls', () => {
  it('leaves season and pro pass balls obtainable only as shop offers', () => {
    const offerable = getOfferableBallTypes();
    for (const ball of [...LEGACY_SEASON_BALLS, ...PRO_PASS_BALLS]) {
      assert.equal(isShopOfferOnlyBall(ball.id), true);
      assert.equal(BALL_TYPES.some((entry) => entry.id === ball.id), false);
      assert.equal(getBallTypeById(ball.id).id, ball.id);
      assert.equal(offerable.some((entry) => entry.id === ball.id), true);
      assert.equal(isBallGiftable(ball), false);
      assert.equal(getBallGiftGemPrice(ball), null);
    }
    assert.equal(isShopOfferOnlyBall('angel'), false);
    assert.equal(getOwnedSeasonBalls(['may-pokeball-2026', 'angel']).map((ball) => ball.id).join(','), 'may-pokeball-2026');
    assert.equal(getOwnedProPassBalls(['pro-bane-thorns-2026']).length, 1);
    assert.equal(getOwnedProPassBalls(['default']).length, 0);
  });
});
