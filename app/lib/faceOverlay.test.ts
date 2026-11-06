import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import {
  AVATAR_HEAD_SPHERE_RADIUS,
  createAvatarFaceOverlayGeometry,
  FACE_OVERLAY_SHELL_RADIUS,
} from './faceOverlay';

test('face overlay shell sits slightly outside the head sphere', () => {
  const geom = createAvatarFaceOverlayGeometry();
  const pos = geom.getAttribute('position');
  const tmp = new Vector3();

  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i);
    const len = tmp.length();
    assert.ok(
      len > AVATAR_HEAD_SPHERE_RADIUS && len <= FACE_OVERLAY_SHELL_RADIUS + 1e-5,
      `vertex length ${len} should be outside head (${AVATAR_HEAD_SPHERE_RADIUS})`,
    );
  }

  // Front of patch (φ ≈ π/2, θ ≈ π/2): positive Z, near equator height
  let foundForward = false;
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i);
    if (tmp.z > FACE_OVERLAY_SHELL_RADIUS * 0.65 && Math.abs(tmp.y) < FACE_OVERLAY_SHELL_RADIUS * 0.55) {
      foundForward = true;
      break;
    }
  }
  assert.ok(foundForward, 'expected vertices on the +Z “face” of the partial sphere');

  geom.dispose();
});

test('face overlay patch is centered near the equator (eyes above mouth in UV space)', () => {
  const geom = createAvatarFaceOverlayGeometry();
  const pos = geom.getAttribute('position');
  const uv = geom.getAttribute('uv');
  const p0 = new Vector3();

  let highestY = -Infinity;
  let lowestY = Infinity;
  let highIdx = 0;
  let lowIdx = 0;

  for (let i = 0; i < pos.count; i++) {
    p0.fromBufferAttribute(pos, i);
    if (p0.y > highestY) {
      highestY = p0.y;
      highIdx = i;
    }
    if (p0.y < lowestY) {
      lowestY = p0.y;
      lowIdx = i;
    }
  }

  const uvHigh = uv.getY(highIdx);
  const uvLow = uv.getY(lowIdx);
  // Three.js maps higher sphere latitude to lower texture v (1→0 top-to-bottom in asset)
  assert.ok(uvHigh > uvLow, 'top of face patch should map to upper part of texture (eyes over mouth)');

  geom.dispose();
});
