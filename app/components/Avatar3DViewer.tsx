'use client';

import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { TextureLoader, SRGBColorSpace, type Group, type Texture } from 'three';
import type { AvatarItem, AvatarPartType } from '../lib/types';
import {
  DEFAULT_SKIN_COLOR,
  getAvatarFaceOverlayUrl,
  getAvatarPartTextureUrl,
  getAccessoryRigPosition,
  getEmoteAnimationId,
  isHeadlessAvatarLook,
  isLoadableAvatarTextureUrl,
} from '../lib/avatarItems';
import { createAvatarFaceOverlayGeometry } from '../lib/faceOverlay';

interface Avatar3DViewerProps {
  layers: Partial<Record<AvatarPartType, AvatarItem>>;
  skinColor?: string;
  /** When true, plays the equipped emote rig animation (e.g. wave). */
  emoteActive?: boolean;
  className?: string;
  /** Allow drag/touch orbit — home menu + avatar shop (MIE-18 point #13). */
  enableRotation?: boolean;
  /** Live UGC/studio draft texture applied to a body slot during preview (MIE-18 / MIE-37). */
  draftTexture?: { partType: AvatarPartType; textureUrl: string } | null;
}

/**
 * Catch Three.js / R3F render errors so a bad texture never whitescreens the app (MIE-40).
 */
class AvatarViewerErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('[Avatar3DViewer] render failed — showing fallback', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
            Avatar preview unavailable
          </div>
        )
      );
    }
    return this.props.children;
  }
}

/** Local and remote SVGs cannot be uploaded straight to WebGL (MIE-40 / MIE-43). */
function isSvgTextureUrl(url: string): boolean {
  return url.startsWith('data:image/svg') || /\.svg(\?|#|$)/i.test(url);
}

/**
 * Draw an SVG (or any image) into a canvas and return a PNG data URL.
 * Face overlays ship as SVG; TextureLoader's SVG path paints a blank plane on
 * several browsers, which made the head look like an untextured sticker.
 */
function rasterizeImageUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('2d context unavailable'));
        return;
      }
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

/**
 * Load a texture without Suspense/useLoader — failed URLs fall back to skin tint (MIE-40).
 * The mesh starts untextured and receives `map` on a later commit. Callers must remount
 * the material when this flips from null to a texture (see WearMaterial).
 */
function useSafeTexture(url: string | null): Texture | null {
  // Invalid URLs never enter state — the hook just renders skin until a real URL arrives.
  const loadable = url && isLoadableAvatarTextureUrl(url) ? url : null;
  const [loaded, setLoaded] = useState<{ url: string; map: Texture } | null>(null);

  useEffect(() => {
    if (!loadable) return;

    let cancelled = false;
    const loader = new TextureLoader();

    const apply = (tex: Texture) => {
      if (cancelled) {
        tex.dispose();
        return;
      }
      tex.colorSpace = SRGBColorSpace;
      tex.needsUpdate = true;
      setLoaded((prev) => {
        if (prev && prev.map !== tex) prev.map.dispose();
        return { url: loadable, map: tex };
      });
    };

    const fail = () => {
      if (cancelled) return;
      console.warn('[Avatar3DViewer] texture failed to load — using skin tint', loadable);
      setLoaded((prev) => {
        if (prev?.url !== loadable) return prev;
        prev.map.dispose();
        return null;
      });
    };

    const run = async () => {
      try {
        // Rasterize SVG first so the GPU never sees an SVG image element.
        const loadUrl = isSvgTextureUrl(loadable) ? await rasterizeImageUrl(loadable) : loadable;
        if (cancelled) return;
        loader.load(loadUrl, apply, undefined, fail);
      } catch {
        fail();
      }
    };

    void run();

    return () => {
      cancelled = true;
      setLoaded((prev) => {
        if (prev?.url !== loadable) return prev;
        prev.map.dispose();
        return null;
      });
    };
  }, [loadable]);

  if (!loadable || loaded?.url !== loadable) return null;
  return loaded.map;
}

/**
 * Body material that actually shows a wear texture.
 *
 * MIE-40 switched texture loading off `useLoader` (which suspended until the
 * map existed) onto an async state update. Three compiles a different shader
 * when `map` is null. Assigning `map` afterwards does not recompile that
 * program, so shirts/pants/hair stayed a flat skin-colored block — the
 * "avatars are 2D again" regression (MIE-43). Remounting via `key` builds the
 * textured shader with the map already attached.
 */
function WearMaterial({ map, color }: { map: Texture | null; color: string }) {
  return (
    <meshStandardMaterial
      color={map ? '#ffffff' : color}
      map={map ?? undefined}
      roughness={0.62}
      metalness={0.04}
    />
  );
}

/** Body-part box mesh — skin tint when texture is missing or fails to load (MIE-38 / MIE-40). */
function PartMesh({
  textureUrl,
  color,
  position,
  size,
}: {
  textureUrl: string | null;
  color: string;
  position: [number, number, number];
  size: [number, number, number];
}) {
  const map = useSafeTexture(textureUrl);

  return (
    <mesh position={position} castShadow>
      <boxGeometry args={size} />
      {/* Key lives on the parent so React remounts the material when the map arrives. */}
      <WearMaterial key={map ? 'textured' : 'skin'} map={map} color={color} />
    </mesh>
  );
}

/** Head sphere that accepts an optional wear texture (MIE-41). */
function HeadMesh({
  textureUrl,
  color,
}: {
  textureUrl: string | null;
  color: string;
}) {
  const map = useSafeTexture(textureUrl);

  return (
    <mesh position={[0, 1.5, 0]} castShadow>
      <sphereGeometry args={[0.38, 24, 24]} />
      <WearMaterial key={map ? 'textured' : 'skin'} map={map} color={color} />
    </mesh>
  );
}

/**
 * Face expression decal on the 3D head (MIE-18 / MIE-45).
 * Uses a partial sphere shell concentric with `HeadMesh` so the texture is not buried
 * inside the opaque head sphere (that bug showed only the texture edges down the sides).
 */
function FaceOverlay({ url }: { url: string }) {
  const map = useSafeTexture(url);
  const geometry = useMemo(() => createAvatarFaceOverlayGeometry(), []);
  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  if (!map) return null;
  return (
    <mesh position={[0, 1.5, 0]} geometry={geometry}>
      <meshBasicMaterial map={map} transparent alphaTest={0.05} depthWrite={false} />
    </mesh>
  );
}

/**
 * Procedural starter rig — separate 3D body parts with 2D texture maps (MIE-18).
 * Right arm ref drives the wave emote animation.
 */
function AvatarRig({
  layers,
  skinColor,
  emoteActive,
  draftTexture,
}: {
  layers: Partial<Record<AvatarPartType, AvatarItem>>;
  skinColor: string;
  emoteActive: boolean;
  draftTexture?: { partType: AvatarPartType; textureUrl: string } | null;
}) {
  const rightArmRef = useRef<Group>(null);
  const emoteItem = layers.emote;
  const emoteId = emoteActive ? getEmoteAnimationId(emoteItem) : null;
  const headless = isHeadlessAvatarLook(layers);
  const faceUrl = headless ? null : getAvatarFaceOverlayUrl(layers.face);
  const accessoryPosition = getAccessoryRigPosition(headless);

  const textures = useMemo(() => {
    const resolve = (part: AvatarPartType, item?: AvatarItem) => {
      if (draftTexture?.partType === part) {
        return isLoadableAvatarTextureUrl(draftTexture.textureUrl) ? draftTexture.textureUrl : null;
      }
      return getAvatarPartTextureUrl(item);
    };
    return {
      head: resolve('head', layers.head),
      shirt: resolve('shirt', layers.shirt),
      hair: resolve('hair', layers.hair),
      pants: resolve('pants', layers.pants),
      arm: resolve('arm', layers.arm),
      leg: resolve('leg', layers.leg),
      hand: resolve('hand', layers.hand),
      foot: resolve('foot', layers.foot),
      sock: resolve('sock', layers.sock),
      accessory: resolve('accessory', layers.accessory),
    };
  }, [layers, draftTexture]);

  // Wave emote: right arm lifts and shakes back and forth (MIE-18 point #8).
  useFrame((state) => {
    if (!rightArmRef.current || emoteId !== 'wave') {
      if (rightArmRef.current) {
        rightArmRef.current.rotation.set(0, 0, 0);
      }
      return;
    }
    const t = state.clock.elapsedTime;
    rightArmRef.current.rotation.z = -0.9 + Math.sin(t * 10) * 0.45;
    rightArmRef.current.rotation.x = Math.sin(t * 7) * 0.25;
  });

  return (
    <group position={[0, -0.2, 0]}>
      {/* Head — hidden when wearing Headless Head; otherwise wear texture or skin (MIE-47). */}
      {!headless && <HeadMesh textureUrl={textures.head} color={skinColor} />}

      {/* Hair */}
      <PartMesh textureUrl={textures.hair} color={skinColor} position={[0, 1.82, 0]} size={[0.72, 0.28, 0.5]} />

      {/* Torso / shirt */}
      <PartMesh textureUrl={textures.shirt} color={skinColor} position={[0, 0.85, 0]} size={[0.7, 0.75, 0.38]} />

      {/* Left arm */}
      <PartMesh textureUrl={textures.arm} color={skinColor} position={[-0.52, 0.9, 0]} size={[0.22, 0.55, 0.22]} />

      {/* Right arm — animated for wave emote */}
      <group ref={rightArmRef} position={[0.52, 0.9, 0]}>
        <PartMesh textureUrl={textures.arm} color={skinColor} position={[0, 0, 0]} size={[0.22, 0.55, 0.22]} />
        <PartMesh textureUrl={textures.hand} color={skinColor} position={[0, -0.38, 0]} size={[0.18, 0.18, 0.18]} />
      </group>

      {/* Left hand */}
      <PartMesh textureUrl={textures.hand} color={skinColor} position={[-0.52, 0.55, 0]} size={[0.18, 0.18, 0.18]} />

      {/* Pants */}
      <PartMesh textureUrl={textures.pants} color={skinColor} position={[0, 0.2, 0]} size={[0.62, 0.5, 0.36]} />

      {/* Legs */}
      <PartMesh textureUrl={textures.leg} color={skinColor} position={[-0.18, -0.35, 0]} size={[0.24, 0.55, 0.24]} />
      <PartMesh textureUrl={textures.leg} color={skinColor} position={[0.18, -0.35, 0]} size={[0.24, 0.55, 0.24]} />

      {/* Socks */}
      <PartMesh textureUrl={textures.sock} color={skinColor} position={[-0.18, -0.72, 0]} size={[0.22, 0.22, 0.22]} />
      <PartMesh textureUrl={textures.sock} color={skinColor} position={[0.18, -0.72, 0]} size={[0.22, 0.22, 0.22]} />

      {/* Feet */}
      <PartMesh textureUrl={textures.foot} color={skinColor} position={[-0.18, -0.92, 0.06]} size={[0.26, 0.14, 0.34]} />
      <PartMesh textureUrl={textures.foot} color={skinColor} position={[0.18, -0.92, 0.06]} size={[0.26, 0.14, 0.34]} />

      {/* Accessory — anchors at the head when headless so sunglasses float (MIE-47). */}
      {textures.accessory && (
        <PartMesh
          textureUrl={textures.accessory}
          color="#ffffff"
          position={accessoryPosition}
          size={headless ? [0.42, 0.16, 0.12] : [0.2, 0.2, 0.2]}
        />
      )}

      {/* Face expression overlay */}
      {faceUrl && <FaceOverlay url={faceUrl} />}
    </group>
  );
}

function AvatarScene({
  layers,
  skinColor,
  emoteActive,
  enableRotation,
  draftTexture,
}: {
  layers: Partial<Record<AvatarPartType, AvatarItem>>;
  skinColor: string;
  emoteActive: boolean;
  enableRotation: boolean;
  draftTexture?: { partType: AvatarPartType; textureUrl: string } | null;
}) {
  return (
    <>
      {/* Lower ambient so the side faces stay darker — a front-on wash made the
          rig read as a flat sprite even after textures loaded (MIE-43). */}
      <ambientLight intensity={0.42} />
      <directionalLight position={[2.6, 4.2, 3.2]} intensity={1.45} castShadow />
      <directionalLight position={[-2.4, 1.6, -2.2]} intensity={0.38} />
      <Suspense fallback={null}>
        <AvatarRig
          layers={layers}
          skinColor={skinColor}
          emoteActive={emoteActive}
          draftTexture={draftTexture}
        />
      </Suspense>
      {enableRotation && (
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 1.6}
          target={[0, 0.6, 0]}
        />
      )}
    </>
  );
}

/**
 * Three.js avatar preview — resilient to bad UGC textures (MIE-18 / MIE-40).
 */
export default function Avatar3DViewer({
  layers,
  skinColor = DEFAULT_SKIN_COLOR,
  emoteActive = false,
  className = '',
  enableRotation = true,
  draftTexture = null,
}: Avatar3DViewerProps) {
  return (
    <div className={`relative w-40 h-64 sm:w-48 sm:h-72 ${className}`}>
      <AvatarViewerErrorBoundary>
        <Canvas
          // Three-quarter start so depth is visible before the player drags.
          camera={{ position: [1.05, 1.12, 2.65], fov: 40 }}
          shadows
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
        >
          <AvatarScene
            layers={layers}
            skinColor={skinColor}
            emoteActive={emoteActive}
            enableRotation={enableRotation}
            draftTexture={draftTexture}
          />
        </Canvas>
      </AvatarViewerErrorBoundary>
      {enableRotation && (
        <p className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-gray-400 pointer-events-none">
          Drag to rotate
        </p>
      )}
    </div>
  );
}
