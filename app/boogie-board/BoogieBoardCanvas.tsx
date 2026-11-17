'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

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

interface WaveMaterials {
  body: THREE.MeshStandardMaterial;
  missed: THREE.MeshStandardMaterial;
  foam: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  buoy: THREE.MeshStandardMaterial;
  guide: THREE.MeshBasicMaterial;
}

function createWaveMaterials(): WaveMaterials {
  return {
    body: new THREE.MeshStandardMaterial({
      color: '#1287ad',
      roughness: 0.22,
      metalness: 0.05,
    }),
    missed: new THREE.MeshStandardMaterial({
      color: '#e11d48',
      roughness: 0.35,
      emissive: '#9f1239',
      emissiveIntensity: 0.25,
    }),
    foam: new THREE.MeshStandardMaterial({ color: '#f8feff', roughness: 0.55 }),
    frame: new THREE.MeshStandardMaterial({
      color: '#f9a8d4',
      emissive: '#ec4899',
      emissiveIntensity: 0.7,
      roughness: 0.4,
    }),
    buoy: new THREE.MeshStandardMaterial({
      color: '#f472b6',
      emissive: '#db2777',
      emissiveIntensity: 0.4,
      roughness: 0.35,
    }),
    guide: new THREE.MeshBasicMaterial({
      color: '#fbbf24',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  };
}

function disposeGeometries(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });
}

function addBox(
  group: THREE.Group,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  part: string
) {
  const [width, height, depth] = size;
  if (width <= 0.02 || height <= 0.02 || depth <= 0.02) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.userData.part = part;
  group.add(mesh);
}

/** A wave wall with one hole, plus a path on the water that leads into it. */
function buildWaveMesh(wave: WaveState, mats: WaveMaterials): THREE.Group {
  const group = new THREE.Group();
  const holeLeft = wave.holeCenterX - wave.holeHalfWidth;
  const holeRight = wave.holeCenterX + wave.holeHalfWidth;
  const depth = wave.thickness;
  const leftWidth = holeLeft + WAVE_EXTENT;
  const rightWidth = WAVE_EXTENT - holeRight;
  const lintelHeight = WAVE_HEIGHT - HOLE_HEIGHT;

  addBox(group, [leftWidth, WAVE_HEIGHT, depth], [-WAVE_EXTENT + leftWidth / 2, WAVE_HEIGHT / 2, 0], mats.body, 'body');
  addBox(group, [rightWidth, WAVE_HEIGHT, depth], [holeRight + rightWidth / 2, WAVE_HEIGHT / 2, 0], mats.body, 'body');
  addBox(
    group,
    [holeRight - holeLeft, lintelHeight, depth],
    [wave.holeCenterX, HOLE_HEIGHT + lintelHeight / 2, 0],
    mats.body,
    'body'
  );

  const foamY = WAVE_HEIGHT + 0.04;
  addBox(group, [leftWidth, 0.16, depth + 0.25], [-WAVE_EXTENT + leftWidth / 2, foamY, -0.08], mats.foam, 'foam');
  addBox(group, [rightWidth, 0.16, depth + 0.25], [holeRight + rightWidth / 2, foamY, -0.08], mats.foam, 'foam');
  addBox(group, [holeRight - holeLeft, 0.16, depth + 0.25], [wave.holeCenterX, foamY, -0.08], mats.foam, 'foam');

  addBox(group, [0.12, HOLE_HEIGHT, depth + 0.08], [holeLeft, HOLE_HEIGHT / 2, 0], mats.frame, 'frame');
  addBox(group, [0.12, HOLE_HEIGHT, depth + 0.08], [holeRight, HOLE_HEIGHT / 2, 0], mats.frame, 'frame');
  addBox(group, [holeRight - holeLeft, 0.12, depth + 0.08], [wave.holeCenterX, HOLE_HEIGHT, 0], mats.frame, 'frame');

  for (const x of [holeLeft, holeRight]) {
    const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, HOLE_HEIGHT, 10), mats.buoy);
    buoy.position.set(x, HOLE_HEIGHT / 2, depth * 0.2);
    buoy.userData.part = 'buoy';
    group.add(buoy);
  }

  const guideLength = 22;
  const guide = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.8, (holeRight - holeLeft) * 0.7), guideLength),
    mats.guide
  );
  guide.rotation.x = -Math.PI / 2;
  guide.position.set(wave.holeCenterX, 0.08, -guideLength / 2);
  guide.renderOrder = 2;
  group.add(guide);

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

  useEffect(() => {
    const poolRef = pool.current;
    return () => {
      poolRef.forEach((mesh) => disposeGeometries(mesh));
      poolRef.clear();
      Object.values(materials).forEach((material) => material.dispose());
    };
  }, [materials]);

  useFrame(() => {
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
}: {
  stateRef: React.RefObject<RunState>;
  inputRef: React.RefObject<SteerInput>;
  cameraMode: CameraMode;
}) {
  const group = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const state = stateRef.current;
    if (!group.current || !state) return;
    const t = clock.elapsedTime;
    const lean = (inputRef.current.left ? 1 : 0) - (inputRef.current.right ? 1 : 0);
    group.current.position.set(state.playerX, Math.sin(t * 2.1) * 0.045, 0);
    group.current.rotation.z = lean * 0.18;
    group.current.rotation.x = Math.sin(t * 2.1) * 0.025;
    if (head.current) head.current.visible = cameraMode !== 'first';
  });

  return (
    <group ref={group}>
      <mesh position={[0, 0.16, 0.05]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.72, 0.09, 1.6]} />
        <meshStandardMaterial color="#7c3aed" />
      </mesh>
      <mesh position={[0, 0.215, 0.05]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.16, 0.02, 1.45]} />
        <meshStandardMaterial color="#f9a8d4" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0.05]}>
        <circleGeometry args={[0.5, 20]} />
        <meshBasicMaterial color="#06325c" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.36, -0.02]} rotation={[0.45, 0, 0]}>
        <boxGeometry args={[0.4, 0.2, 0.55]} />
        <meshStandardMaterial color="#ec4899" />
      </mesh>
      <mesh position={[-0.28, 0.32, 0.32]} rotation={[1.15, 0, 0.15]}>
        <boxGeometry args={[0.1, 0.1, 0.42]} />
        <meshStandardMaterial color="#f3c7a1" />
      </mesh>
      <mesh position={[0.28, 0.32, 0.32]} rotation={[1.15, 0, -0.15]}>
        <boxGeometry args={[0.1, 0.1, 0.42]} />
        <meshStandardMaterial color="#f3c7a1" />
      </mesh>
      <mesh position={[-0.12, 0.3, -0.42]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[0.12, 0.12, 0.38]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
      <mesh position={[0.12, 0.3, -0.42]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[0.12, 0.12, 0.38]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
      <group ref={head} position={[0, 0.52, 0.48]}>
        <mesh>
          <sphereGeometry args={[0.16, 20, 16]} />
          <meshStandardMaterial color="#f3c7a1" />
        </mesh>
        <mesh position={[0, 0.07, -0.02]}>
          <sphereGeometry args={[0.145, 16, 12]} />
          <meshStandardMaterial color="#4c1d95" />
        </mesh>
        <mesh position={[-0.055, 0.01, 0.13]}>
          <sphereGeometry args={[0.026, 10, 10]} />
          <meshBasicMaterial color="#1e1b4b" />
        </mesh>
        <mesh position={[0.055, 0.01, 0.13]}>
          <sphereGeometry args={[0.026, 10, 10]} />
          <meshBasicMaterial color="#1e1b4b" />
        </mesh>
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
  onMiss,
  onClear,
  onGameOver,
}: {
  runId: number;
  cameraMode: CameraMode;
  inputRef: React.RefObject<SteerInput>;
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
        <Rider stateRef={stateRef} inputRef={inputRef} cameraMode={cameraMode} />
        <FollowCamera cameraMode={cameraMode} stateRef={stateRef} />
      </Canvas>
    </div>
  );
}
