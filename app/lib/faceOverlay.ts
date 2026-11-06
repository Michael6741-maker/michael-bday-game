/**
 * 3D face sticker for avatars (MIE-45).
 *
 * The head is a solid `sphereGeometry` at y=1.5. A flat `planeGeometry` placed near
 * [0, 1.52, 0.33] sits *inside* that sphere, so only the texture margins peek out along
 * the sides — it looks like the face “runs downward”. We instead map the same texture
 * onto a thin spherical patch concentric with the head, slightly outside the skin radius.
 */
import { SphereGeometry } from 'three';

/** Kept in sync with `HeadMesh` in `Avatar3DViewer.tsx`. */
export const AVATAR_HEAD_SPHERE_RADIUS = 0.38;

/**
 * Just outside the opaque head mesh so the decal renders on top without hiding inside it.
 */
export const FACE_OVERLAY_SHELL_RADIUS = AVATAR_HEAD_SPHERE_RADIUS + 0.012;

/** Angular width around +Z (~109°) — matches the spec note on MIE-45. */
const FACE_PHI_LENGTH_RAD = (109 * Math.PI) / 180;

/** Vertical band around the equator (forehead through mouth). */
const FACE_THETA_LENGTH_RAD = (58 * Math.PI) / 180;

/**
 * Returns a disposable `SphereGeometry`: a partial sphere centered on the origin, opening
 * toward +Z (same convention as Three’s full sphere: φ = π/2 is +Z on the equator).
 */
export function createAvatarFaceOverlayGeometry(): SphereGeometry {
  const phiStart = Math.PI / 2 - FACE_PHI_LENGTH_RAD / 2;
  const thetaStart = Math.PI / 2 - FACE_THETA_LENGTH_RAD / 2;
  return new SphereGeometry(
    FACE_OVERLAY_SHELL_RADIUS,
    32,
    24,
    phiStart,
    FACE_PHI_LENGTH_RAD,
    thetaStart,
    FACE_THETA_LENGTH_RAD,
  );
}
