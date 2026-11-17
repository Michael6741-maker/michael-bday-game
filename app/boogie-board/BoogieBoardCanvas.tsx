'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { AvatarRig } from '../components/Avatar3DViewer';
import type { AvatarItem, AvatarPartType } from '../lib/types';
import {
  HOLE_HEIGHT,
  LANE_LIMIT,
  WAVE_EXTENT,
  WAVE_HEIGHT,
  createRun,
  stepRun,
  type CameraMode,
  type RunState,
  type SteerInput,
  type WaveState,
} from '../lib/boogieBoard';

export type AvatarLayers = Partial<Record<AvatarPartType, AvatarItem>>;

interface WaveMaterials {
  body: THREE.ShaderMaterial;
  missed: THREE.MeshStandardMaterial;
  foam: THREE.MeshStandardMaterial;
}

const WAVE_VERT = `
  attribute float aCrest;
  varying float vCrest;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  uniform float uTime;
  void main() {
    vCrest = aCrest;
    vec3 p = position;
    p.y += sin(position.x * 1.6 + uTime * 1.4) * 0.07 * aCrest;
    p.z += sin(position.x * 2.1 - uTime * 1.1) * 0.06 * aCrest;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WAVE_FRAG = `
  varying float vCrest;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  uniform float uTime;
  void main() {
    vec3 deep = vec3(0.05, 0.45, 0.78);
    vec3 face = vec3(0.28, 0.78, 0.96);
    vec3 lip = vec3(0.96, 0.99, 1.0);
    float crest = smoothstep(0.48, 0.9, vCrest);
    float foamBand = smoothstep(0.72, 1.0, vCrest);
    float foot = smoothstep(0.22, 0.0, vCrest);
    float lace = smoothstep(0.4, 0.95, sin(vWorld.x * 3.4 + vCrest * 14.0 - uTime * 2.2));
    vec3 col = mix(deep, face, smoothstep(0.0, 0.55, vCrest));
    col = mix(col, lip, max(crest * 0.9, foot * 0.75));
    col = mix(col, vec3(1.0), foamBand * (0.55 + lace * 0.45));
    vec3 lightDir = normalize(vec3(-0.2, 0.72, -0.66));
    float ndl = clamp(dot(normalize(vNormalW), lightDir), 0.0, 1.0);
    col *= 0.82 + 0.35 * ndl;
    float spec = pow(clamp(dot(normalize(vNormalW), normalize(lightDir + vec3(0.0, 0.2, -0.8))), 0.0, 1.0), 20.0);
    col += spec * 0.45;
    gl_FragColor = vec4(col, mix(0.9, 0.98, max(crest, foot)));
  }
`;

function createWaveMaterials(): WaveMaterials {
  return {
    body: new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: WAVE_VERT,
      fragmentShader: WAVE_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
    }),
    missed: new THREE.MeshStandardMaterial({
      color: '#e11d48',
      roughness: 0.35,
      emissive: '#9f1239',
      emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
    }),
    foam: new THREE.MeshStandardMaterial({ color: '#f8feff', roughness: 0.45 }),
  };
}

function disposeGeometries(object: THREE.Object3D) {
  const seen = new Set<THREE.BufferGeometry>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || seen.has(child.geometry)) return;
    seen.add(child.geometry);
    child.geometry.dispose();
  });
}

/** Point on the curling face. v is 0 at the water and 1 at the lip. */
function curlPoint(x: number, y0: number, y1: number, v: number): { x: number; y: number; z: number } {
  const rise = y0 + (y1 - y0) * v;
  const swell = Math.sin(v * Math.PI) * 0.9 + Math.pow(v, 1.7) * 1.7;
  const y = rise + Math.sin(x * 0.85) * 0.48 * v;
  const z = -swell + Math.sin(x * 1.25 + v * 2.0) * 0.28 * v;
  return { x, y, z };
}

/** A breaking face with one open hole. No path is drawn on the water. */
function buildWaveMesh(wave: WaveState, mats: WaveMaterials): THREE.Group {
  const group = new THREE.Group();
  const holeLeft = wave.holeCenterX - wave.holeHalfWidth;
  const holeRight = wave.holeCenterX + wave.holeHalfWidth;
  const foamGeo = new THREE.SphereGeometry(1, 8, 6);

  const addCurl = (x0: number, x1: number, y0: number, y1: number) => {
    const width = x1 - x0;
    const height = y1 - y0;
    if (width < 0.08 || height < 0.08) return;
    const segX = Math.max(6, Math.round(width * 2.4));
    const segY = 16;
    const positions: number[] = [];
    const crests: number[] = [];
    const indices: number[] = [];
    const at = (ix: number, iy: number) => {
      const u = ix / segX;
      const v = iy / segY;
      return curlPoint(x0 + width * u, y0, y1, v);
    };
    for (let iy = 0; iy <= segY; iy++) {
      for (let ix = 0; ix <= segX; ix++) {
        const p = at(ix, iy);
        positions.push(p.x, p.y, p.z);
        crests.push(iy / segY);
      }
    }
    const indexAt = (ix: number, iy: number) => iy * (segX + 1) + ix;
    for (let iy = 0; iy < segY; iy++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = indexAt(ix, iy);
        const b = indexAt(ix + 1, iy);
        const c = indexAt(ix, iy + 1);
        const d = indexAt(ix + 1, iy + 1);
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aCrest', new THREE.Float32BufferAttribute(crests, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mats.body);
    mesh.userData.part = 'body';
    group.add(mesh);

    const blobs = Math.max(3, Math.round(width / 0.48));
    for (let i = 0; i <= blobs; i++) {
      const p = at(Math.round((i / blobs) * segX), segY);
      const blob = new THREE.Mesh(foamGeo, mats.foam);
      const size = 0.2 + (i % 2) * 0.1;
      blob.scale.set(size, size * 0.62, size);
      blob.position.set(p.x, p.y + 0.04, p.z - 0.04);
      blob.userData.part = 'foam';
      group.add(blob);
    }
  };

  addCurl(-WAVE_EXTENT, holeLeft, 0, WAVE_HEIGHT);
  addCurl(holeRight, WAVE_EXTENT, 0, WAVE_HEIGHT);
  addCurl(holeLeft, holeRight, HOLE_HEIGHT, WAVE_HEIGHT);

  for (const x of [holeLeft, holeRight]) {
    for (let i = 0; i <= 5; i++) {
      const y = (HOLE_HEIGHT * i) / 5;
      const p = curlPoint(x, 0, WAVE_HEIGHT, y / WAVE_HEIGHT);
      const blob = new THREE.Mesh(foamGeo, mats.foam);
      blob.scale.set(0.1, 0.1, 0.1);
      blob.position.set(p.x, p.y, p.z);
      blob.userData.part = 'foam';
      group.add(blob);
    }
  }

  group.userData.applied = 'pending';
  return group;
}

const WATER_VERT = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vElev;
  void main() {
    vUv = uv;
    vec3 p = position;
    float elev = sin(position.x * 0.32 + uTime * 1.25) * 0.1
      + sin(position.y * 0.24 + uTime * 0.85) * 0.07;
    p.z += elev;
    vElev = elev;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const WATER_FRAG = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vElev;
  void main() {
    vec3 deep = vec3(0.03, 0.25, 0.58);
    vec3 mid = vec3(0.12, 0.58, 0.9);
    vec3 glint = vec3(0.85, 0.95, 1.0);
    float spark = smoothstep(0.75, 1.0, sin(vUv.x * 48.0 + uTime) * sin(vUv.y * 36.0 - uTime * 0.8));
    vec3 col = mix(deep, mid, clamp(0.4 + vElev * 2.4, 0.0, 1.0));
    col = mix(col, glint, spark * 0.38);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SKY_VERT = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = `
  varying vec3 vPos;
  void main() {
    float h = normalize(vPos).y;
    vec3 top = vec3(0.36, 0.38, 0.86);
    vec3 mid = vec3(0.55, 0.76, 0.98);
    vec3 horizon = vec3(0.99, 0.68, 0.84);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, h));
    col = mix(col, top, smoothstep(0.22, 0.85, h));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Ocean() {
  const material = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock }) => {
    if (material.current) material.current.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 18]}>
      <planeGeometry args={[96, 150, 64, 64]} />
      <shaderMaterial
        ref={material}
        uniforms={{ uTime: { value: 0 } }}
        vertexShader={WATER_VERT}
        fragmentShader={WATER_FRAG}
      />
    </mesh>
  );
}

function SkyDome() {
  return (
    <mesh>
      <sphereGeometry args={[210, 28, 18]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
      />
    </mesh>
  );
}

function LaneMarkers() {
  const posts: { x: number; z: number }[] = [];
  for (let z = -4; z <= 46; z += 6) {
    posts.push({ x: -LANE_LIMIT - 0.45, z });
    posts.push({ x: LANE_LIMIT + 0.45, z });
  }

  return (
    <group>
      {posts.map((post) => (
        <mesh key={`${post.x}:${post.z}`} position={[post.x, 0.38, post.z]}>
          <cylinderGeometry args={[0.07, 0.07, 0.76, 8]} />
          <meshStandardMaterial color={post.x < 0 ? '#f9a8d4' : '#ffffff'} />
        </mesh>
      ))}
    </group>
  );
}

function Simulation({
  runId,
  stateRef,
  inputRef,
  onMiss,
  onClear,
  onGameOver,
}: {
  runId: number;
  stateRef: React.RefObject<RunState>;
  inputRef: React.RefObject<SteerInput>;
  onMiss: (lives: number, runId: number) => void;
  onClear: (survived: number, runId: number) => void;
  onGameOver: (survived: number, runId: number) => void;
}) {
  const seenRun = useRef<number | null>(null);

  useFrame((_, dt) => {
    if (seenRun.current !== runId) {
      seenRun.current = runId;
      stateRef.current = createRun();
      return;
    }

    const stepped = stepRun(stateRef.current, inputRef.current, dt);
    stateRef.current = stepped.state;
    for (const event of stepped.events) {
      if (event.type === 'missed') onMiss(event.lives, runId);
      else if (event.type === 'cleared') onClear(event.survived, runId);
      else onGameOver(event.survived, runId);
    }
  });

  return null;
}

function Waves({ runId, stateRef }: { runId: number; stateRef: React.RefObject<RunState> }) {
  const group = useRef<THREE.Group>(null);
  const pool = useRef<Map<number, THREE.Group>>(new Map());
  const seenRun = useRef(runId);
  const materials = useMemo(() => createWaveMaterials(), []);
  const bodyMaterial = useRef(materials.body);

  useEffect(() => {
    const poolRef = pool.current;
    return () => {
      poolRef.forEach((mesh) => disposeGeometries(mesh));
      poolRef.clear();
      Object.values(materials).forEach((material) => material.dispose());
    };
  }, [materials]);

  useFrame(({ clock }) => {
    bodyMaterial.current.uniforms.uTime.value = clock.elapsedTime;
    const root = group.current;
    const state = stateRef.current;
    if (!root || !state) return;

    if (seenRun.current !== runId) {
      seenRun.current = runId;
      for (const mesh of pool.current.values()) {
        root.remove(mesh);
        disposeGeometries(mesh);
      }
      pool.current.clear();
    }

    const live = new Set<number>();
    for (const wave of state.waves) {
      live.add(wave.id);
      let mesh = pool.current.get(wave.id);
      if (!mesh) {
        mesh = buildWaveMesh(wave, materials);
        pool.current.set(wave.id, mesh);
        root.add(mesh);
      }
      mesh.position.z = wave.z;
      if (mesh.userData.applied !== wave.result) {
        mesh.userData.applied = wave.result;
        const body = wave.result === 'missed' ? materials.missed : materials.body;
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.userData.part === 'body') {
            child.material = body;
          }
        });
      }
    }

    for (const [id, mesh] of pool.current) {
      if (live.has(id)) continue;
      root.remove(mesh);
      disposeGeometries(mesh);
      pool.current.delete(id);
    }
  });

  return <group ref={group} />;
}

function Rider({
  stateRef,
  inputRef,
  cameraMode,
  layers,
  skinColor,
}: {
  stateRef: React.RefObject<RunState>;
  inputRef: React.RefObject<SteerInput>;
  cameraMode: CameraMode;
  layers: AvatarLayers;
  skinColor: string;
}) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const state = stateRef.current;
    if (!group.current || !state) return;
    const t = clock.elapsedTime;
    const lean = (inputRef.current.left ? 1 : 0) - (inputRef.current.right ? 1 : 0);
    group.current.position.set(state.playerX, Math.sin(t * 2.1) * 0.045, 0);
    group.current.rotation.z = lean * 0.18;
    group.current.rotation.x = Math.sin(t * 2.1) * 0.025;
  });

  return (
    <group ref={group}>
      <mesh position={[0, 0.16, 0.05]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.78, 0.09, 1.7]} />
        <meshStandardMaterial color="#7c3aed" />
      </mesh>
      <mesh position={[0, 0.215, 0.05]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.16, 0.02, 1.5]} />
        <meshStandardMaterial color="#f9a8d4" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0.05]}>
        <circleGeometry args={[0.55, 20]} />
        <meshBasicMaterial color="#06325c" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <group position={[0, 0.31, 0.08]} rotation={[Math.PI / 2, 0, 0]} scale={0.5}>
        <AvatarRig
          layers={layers}
          skinColor={skinColor}
          emoteActive={false}
          showHead={cameraMode !== 'first'}
        />
      </group>
    </group>
  );
}

function FollowCamera({
  cameraMode,
  stateRef,
}: {
  cameraMode: CameraMode;
  stateRef: React.RefObject<RunState>;
}) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 0.5, 4));
  const desired = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());
  const seenMode = useRef<CameraMode | null>(null);

  useFrame((_, dt) => {
    const x = stateRef.current?.playerX ?? 0;
    if (cameraMode === 'first') {
      desired.current.set(x, 0.74, 0.02);
      desiredLook.current.set(x, 0.46, 14);
    } else {
      // Sit above the wave so the chase camera is not buried when a wave passes.
      desired.current.set(x, 4.6, -6.4);
      desiredLook.current.set(x, 0.7, 2.2);
    }

    const snap = seenMode.current !== cameraMode;
    seenMode.current = cameraMode;
    const blend = snap ? 1 : 1 - Math.exp(-8 * dt);
    camera.position.lerp(desired.current, blend);
    look.current.lerp(desiredLook.current, blend);
    camera.lookAt(look.current);
  });

  return null;
}

export default function BoogieBoardCanvas({
  runId,
  cameraMode,
  inputRef,
  layers,
  skinColor,
  onMiss,
  onClear,
  onGameOver,
}: {
  runId: number;
  cameraMode: CameraMode;
  inputRef: React.RefObject<SteerInput>;
  layers: AvatarLayers;
  skinColor: string;
  onMiss: (lives: number, runId: number) => void;
  onClear: (survived: number, runId: number) => void;
  onGameOver: (survived: number, runId: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<RunState>(createRun());

  // R3F can measure a 0×0 canvas when this chunk mounts before layout.
  // Re-broadcast resize once the host has a real box.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const nudge = () => window.dispatchEvent(new Event('resize'));
    const observer = new ResizeObserver(nudge);
    observer.observe(el);
    const timers = [window.setTimeout(nudge, 0), window.setTimeout(nudge, 250)];
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <div ref={hostRef} className="smooth-canvas absolute inset-0" data-testid="boogie-canvas">
      <Canvas
        frameloop="always"
        dpr={[1, 1.75]}
        camera={{ position: [0, 4.6, -6.4], fov: 62, near: 0.08, far: 320 }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => gl.setClearColor('#8eb7ff')}
      >
        <ambientLight intensity={0.7} />
        <hemisphereLight args={['#dbeafe', '#075985', 0.7]} />
        <directionalLight position={[18, 28, 10]} intensity={1.35} />
        <SkyDome />
        <Ocean />
        <LaneMarkers />
        <Simulation
          runId={runId}
          stateRef={stateRef}
          inputRef={inputRef}
          onMiss={onMiss}
          onClear={onClear}
          onGameOver={onGameOver}
        />
        <Waves runId={runId} stateRef={stateRef} />
        <Rider
          stateRef={stateRef}
          inputRef={inputRef}
          cameraMode={cameraMode}
          layers={layers}
          skinColor={skinColor}
        />
        <FollowCamera cameraMode={cameraMode} stateRef={stateRef} />
      </Canvas>
    </div>
  );
}
