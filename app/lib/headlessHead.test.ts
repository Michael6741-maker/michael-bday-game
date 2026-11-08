/**
 * Headless Head catalog + rig rules (MIE-47). Run with: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_AVATAR_ITEMS,
  canPurchaseAvatarItem,
  getAccessoryRigPosition,
  HEADLESS_HEAD_CATALOG_FIELDS,
  HEADLESS_HEAD_ITEM_ID,
  isHeadlessAvatarLook,
} from './avatarItems';
import type { User } from './types';

const baseUser = {
  username: 'TEST',
  ownedAvatarItems: [] as string[],
} as User;

describe('Headless Head (MIE-47)', () => {
  const catalogItem = {
    id: HEADLESS_HEAD_ITEM_ID,
    ...HEADLESS_HEAD_CATALOG_FIELDS,
    createdAtMs: 1,
    updatedAtMs: 1,
  };

  it('seeds at 1000 gems and 20,000 stock', () => {
    assert.equal(catalogItem.gemPrice, 1000);
    assert.equal(catalogItem.stock, 20_000);
    assert.equal(catalogItem.partType, 'head');
  });

  it('detects headless look from hidesHead flag', () => {
    assert.equal(isHeadlessAvatarLook({ head: catalogItem }), true);
    assert.equal(isHeadlessAvatarLook({ head: BUILTIN_AVATAR_ITEMS[0] }), false);
    assert.equal(isHeadlessAvatarLook({}), false);
  });

  it('floats accessories at the head anchor when headless', () => {
    assert.deepEqual(getAccessoryRigPosition(true), [0, 1.5, 0]);
    assert.deepEqual(getAccessoryRigPosition(false), [0.28, 1.1, -0.1]);
  });

  it('blocks purchase at zero stock and allows until then', () => {
    const richUser = { ...baseUser };
    assert.equal(canPurchaseAvatarItem(richUser, catalogItem), true);

    const soldOut = { ...catalogItem, stock: 0 };
    assert.equal(canPurchaseAvatarItem(richUser, soldOut), false);
  });

  it('simulates 20,000 sales exhausting stock', () => {
    let stock = catalogItem.stock!;
    for (let i = 0; i < 20_000; i++) {
      assert.ok(stock > 0);
      stock -= 1;
    }
    assert.equal(stock, 0);
    const soldOutItem = { ...catalogItem, stock };
    assert.equal(canPurchaseAvatarItem(baseUser, soldOutItem), false);
  });

  it('blocks repeat purchase once owned', () => {
    const owner = { ...baseUser, ownedAvatarItems: [HEADLESS_HEAD_ITEM_ID] } as User;
    assert.equal(canPurchaseAvatarItem(owner, catalogItem), false);
  });
});
