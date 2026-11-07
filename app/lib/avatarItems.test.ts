/**
 * Wear-texture vs shop-thumbnail rules (MIE-38 / MIE-43).
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_AVATAR_ITEMS,
  getAvatarFaceOverlayUrl,
  getAvatarPartTextureUrl,
  getAvatarShopThumbnailUrl,
  isLoadableAvatarTextureUrl,
} from './avatarItems';

describe('avatar wear textures (MIE-43)', () => {
  it('keeps starter shirt/hair/pants on real texture maps, not shop SVGs', () => {
    for (const id of ['starter-shirt-blue', 'starter-hair-brown', 'starter-pants-gray']) {
      const item = BUILTIN_AVATAR_ITEMS.find((entry) => entry.id === id);
      assert.ok(item);
      assert.match(item.textureUrl ?? '', /-texture\.png$/);
      assert.notEqual(getAvatarPartTextureUrl(item), item.previewImageUrl);
      assert.equal(getAvatarShopThumbnailUrl(item), item.previewImageUrl);
    }
  });

  it('does not paint face or emote items as body textures', () => {
    const face = BUILTIN_AVATAR_ITEMS.find((entry) => entry.id === 'starter-face-smile');
    const emote = BUILTIN_AVATAR_ITEMS.find((entry) => entry.id === 'starter-emote-wave');
    assert.equal(getAvatarPartTextureUrl(face), null);
    assert.equal(getAvatarPartTextureUrl(emote), null);
    // Local SVG is allowed here; Avatar3DViewer rasterizes it before WebGL upload.
    assert.equal(getAvatarFaceOverlayUrl(face), '/starter-face-smile.svg');
  });

  it('rejects SVG wear maps that crash TextureLoader', () => {
    assert.equal(isLoadableAvatarTextureUrl('data:image/svg+xml;base64,abc'), false);
    assert.equal(isLoadableAvatarTextureUrl('https://cdn.example.com/shirt.svg'), false);
    assert.equal(isLoadableAvatarTextureUrl('/starter-shirt-blue-texture.png'), true);
    assert.equal(isLoadableAvatarTextureUrl('data:image/png;base64,abc'), true);
    assert.equal(isLoadableAvatarTextureUrl(null), false);
  });

  it('drops an equipped shirt that only has a preview image', () => {
    const stickerOnly = {
      ...BUILTIN_AVATAR_ITEMS[0],
      textureUrl: undefined,
      shirtTextureUrl: undefined,
      previewImageUrl: '/starter-shirt-blue.svg',
    };
    assert.equal(getAvatarPartTextureUrl(stickerOnly), null);
    assert.equal(getAvatarShopThumbnailUrl(stickerOnly), '/starter-shirt-blue.svg');
  });
});
