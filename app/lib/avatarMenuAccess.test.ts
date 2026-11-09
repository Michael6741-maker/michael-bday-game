/**
 * MIE-44: 3D avatar previews stay orbitable, and Avatar Studio stays on the
 * main path for every signed-in player (not only catalog creators).
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AVATAR_SHOP_HREF,
  AVATAR_STUDIO_HREF,
  BUILTIN_AVATAR_ITEMS,
  getAvatarFaceOverlayUrl,
  getAvatarPartTextureUrl,
  isLoadableAvatarTextureUrl,
  isSvgAvatarTextureUrl,
} from './avatarItems';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function readAppFile(rel: string): string {
  return readFileSync(join(appDir, rel), 'utf8');
}

/** Buttons in a source file, so we can assert the WebGL viewer is not inside one. */
function buttonBlocks(source: string): string[] {
  return source.match(/<button[\s\S]*?<\/button>/g) ?? [];
}

describe('avatar routes (MIE-44)', () => {
  it('keeps shop and studio on stable player-facing paths', () => {
    assert.equal(AVATAR_SHOP_HREF, '/avatars');
    assert.equal(AVATAR_STUDIO_HREF, '/avatar-studio');
  });

  it('puts Studio in the global nav and on the shop', () => {
    const nav = readAppFile('components/TopNav.tsx');
    const shop = readAppFile('avatars/AvatarsClient.tsx');
    assert.match(nav, /AVATAR_STUDIO_HREF/);
    assert.match(shop, /AVATAR_STUDIO_HREF/);
    assert.match(shop, /Open Avatar Studio/);
  });

  it('shows the 3D menu preview on the game picker and Platform Drop', () => {
    const picker = readAppFile('page.tsx');
    const menu = readAppFile('platform-drop/page.tsx');
    assert.match(picker, /AvatarMenuPreview/);
    assert.match(menu, /AvatarMenuPreview/);
  });

  it('does not nest the 3D viewer inside a button', () => {
    const files = [
      'page.tsx',
      'platform-drop/page.tsx',
      'components/AvatarMenuPreview.tsx',
      'avatars/AvatarsClient.tsx',
      'avatar-studio/page.tsx',
    ];
    for (const rel of files) {
      for (const block of buttonBlocks(readAppFile(rel))) {
        assert.equal(
          block.includes('Avatar3DViewer') || block.includes('AvatarMenuPreview'),
          false,
          `${rel} wraps the 3D avatar in a button`,
        );
      }
    }
  });
});

describe('avatar wear textures (MIE-44)', () => {
  it('flags svg maps so the viewer rasterizes them instead of TextureLoader', () => {
    assert.equal(isSvgAvatarTextureUrl('/starter-face-smile.svg'), true);
    assert.equal(isSvgAvatarTextureUrl('data:image/svg+xml;base64,abc'), true);
    assert.equal(isSvgAvatarTextureUrl('/starter-shirt-blue-texture.png'), false);
    assert.equal(isSvgAvatarTextureUrl(null), false);
  });

  it('still rejects remote svg wear maps that crash WebGL', () => {
    assert.equal(isLoadableAvatarTextureUrl('https://example.com/shirt.svg'), false);
    assert.equal(isLoadableAvatarTextureUrl('data:image/svg+xml,<svg></svg>'), false);
    assert.equal(isLoadableAvatarTextureUrl('/starter-shirt-blue-texture.png'), true);
  });

  it('keeps starter clothes on png wear maps and the smile as a local face overlay', () => {
    const shirt = BUILTIN_AVATAR_ITEMS.find((item) => item.id === 'starter-shirt-blue');
    const face = BUILTIN_AVATAR_ITEMS.find((item) => item.id === 'starter-face-smile');
    assert.ok(shirt);
    assert.ok(face);
    assert.equal(getAvatarPartTextureUrl(shirt), '/starter-shirt-blue-texture.png');
    assert.equal(getAvatarFaceOverlayUrl(face), '/starter-face-smile.svg');
    assert.equal(getAvatarPartTextureUrl(face), null);
  });
});
