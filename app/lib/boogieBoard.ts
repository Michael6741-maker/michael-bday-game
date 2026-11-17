/**
 * Boogie Board rules.
 *
 * Waves travel toward the rider. Each wave is solid except for one hole.
 * The rider steers left and right. Staying inside the hole until the wave
 * passes counts as a wave survived. Touching the wave outside the hole
 * costs one life. The run ends at 0 lives.
 */

export const STARTING_LIVES = 3;

/** Half the rider's width. The whole body must fit in the hole. */
export const PLAYER_HALF_WIDTH = 0.36;

/** Nose and tail of the board, on the Z axis. Waves approach from +Z. */
export const PLAYER_NOSE_Z = 0.85;
export const PLAYER_TAIL_Z = -0.75;

/** Furthest the rider's center can move left or right. */
export const LANE_LIMIT = 6;

export const STEER_SPEED = 11;
export const WAVE_SPEED_START = 4.6;
export const WAVE_SPEED_MAX = 10;
export const SPAWN_Z = 40;
export const FIRST_WAVE_Z = 44;
export const WAVE_GAP = 32;
export const WAVE_THICKNESS = 1.7;
export const WAVE_EXTENT = 9;
export const WAVE_HEIGHT = 3.45;
export const HOLE_HEIGHT = 1.85;
export const DESPAWN_Z = -14;

export type CameraMode = 'first' | 'third';

export interface SteerInput {
  left: boolean;
  right: boolean;
}

export type WaveResult = 'pending' | 'cleared' | 'missed';

export interface WaveState {
  id: number;
  /** Center of the wave along Z. Decreases as the wave approaches. */
  z: number;
  holeCenterX: number;
  holeHalfWidth: number;
  thickness: number;
  result: WaveResult;
}

export interface RunState {
  lives: number;
  survived: number;
  playerX: number;
  status: 'playing' | 'gameover';
  waves: WaveState[];
  nextId: number;
  random: () => number;
}

export type RunEvent =
  | { type: 'cleared'; waveId: number; survived: number }
  | { type: 'missed'; waveId: number; lives: number }
  | { type: 'gameover'; survived: number };

export interface StepResult {
  state: RunState;
  events: RunEvent[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function waveSpeed(survived: number): number {
  return Math.min(WAVE_SPEED_MAX, WAVE_SPEED_START + survived * 0.28);
}

function holeHalfWidthFor(survived: number): number {
  return Math.max(1.25, 2.35 - survived * 0.04);
}

function createWave(id: number, random: () => number, survived: number, z: number): WaveState {
  const holeHalfWidth = holeHalfWidthFor(survived);
  const reach = LANE_LIMIT - 0.4;
  const holeCenterX = (random() * 2 - 1) * reach;
  return {
    id,
    z,
    holeCenterX,
    holeHalfWidth,
    thickness: WAVE_THICKNESS,
    result: 'pending',
  };
}

/** True when the rider's full width is inside the hole. */
export function playerInHole(playerX: number, wave: WaveState): boolean {
  const left = playerX - PLAYER_HALF_WIDTH;
  const right = playerX + PLAYER_HALF_WIDTH;
  const holeLeft = wave.holeCenterX - wave.holeHalfWidth;
  const holeRight = wave.holeCenterX + wave.holeHalfWidth;
  return left >= holeLeft - 1e-4 && right <= holeRight + 1e-4;
}

export function createRun(random: () => number = Math.random): RunState {
  return {
    lives: STARTING_LIVES,
    survived: 0,
    playerX: 0,
    status: 'playing',
    waves: [createWave(1, random, 0, FIRST_WAVE_Z)],
    nextId: 2,
    random,
  };
}

function resolveWave(
  wave: WaveState,
  playerX: number,
  lives: number,
  survived: number,
  events: RunEvent[]
): { lives: number; survived: number; status: RunState['status'] } {
  if (playerInHole(playerX, wave)) {
    wave.result = 'cleared';
    const nextSurvived = survived + 1;
    events.push({ type: 'cleared', waveId: wave.id, survived: nextSurvived });
    return { lives, survived: nextSurvived, status: 'playing' };
  }

  wave.result = 'missed';
  const nextLives = lives - 1;
  events.push({ type: 'missed', waveId: wave.id, lives: nextLives });
  if (nextLives <= 0) {
    events.push({ type: 'gameover', survived });
    return { lives: 0, survived, status: 'gameover' };
  }
  return { lives: nextLives, survived, status: 'playing' };
}

function stepOnce(state: RunState, input: SteerInput, dt: number): StepResult {
  const events: RunEvent[] = [];
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const playerX = clamp(state.playerX + dir * STEER_SPEED * dt, -LANE_LIMIT, LANE_LIMIT);
  const speed = waveSpeed(state.survived);

  let lives = state.lives;
  let survived = state.survived;
  let status: RunState['status'] = 'playing';

  const waves = state.waves.map((wave) => ({ ...wave, z: wave.z - speed * dt }));

  for (const wave of waves) {
    if (wave.result !== 'pending' || status !== 'playing') continue;

    const front = wave.z - wave.thickness / 2;
    const back = wave.z + wave.thickness / 2;
    const overlaps = front <= PLAYER_NOSE_Z && back >= PLAYER_TAIL_Z;
    const passed = back < PLAYER_TAIL_Z;
    if (!overlaps && !passed) continue;

    // Outside the hole, the wave hits as soon as it reaches the board.
    // Inside the hole, the wave counts only once it has fully passed.
    if (!playerInHole(playerX, wave) && (overlaps || passed)) {
      const resolved = resolveWave(wave, playerX, lives, survived, events);
      lives = resolved.lives;
      survived = resolved.survived;
      status = resolved.status;
    } else if (passed) {
      const resolved = resolveWave(wave, playerX, lives, survived, events);
      lives = resolved.lives;
      survived = resolved.survived;
      status = resolved.status;
    }
  }

  const remaining = waves.filter((wave) => wave.z > DESPAWN_Z);
  let nextId = state.nextId;

  if (status === 'playing') {
    const newest = remaining.reduce<WaveState | null>(
      (best, wave) => (best == null || wave.z > best.z ? wave : best),
      null
    );
    if (newest == null || newest.z < SPAWN_Z - WAVE_GAP) {
      remaining.push(createWave(nextId, state.random, survived, SPAWN_Z));
      nextId += 1;
    }
  }

  return {
    state: {
      ...state,
      lives,
      survived,
      playerX,
      status,
      waves: remaining,
      nextId,
    },
    events,
  };
}

/**
 * Advance one frame. Large gaps are capped and split so a wave cannot skip
 * past the rider without a hit check.
 */
export function stepRun(state: RunState, input: SteerInput, dt: number): StepResult {
  if (state.status !== 'playing') {
    return { state, events: [] };
  }

  let current = state;
  const events: RunEvent[] = [];
  let remaining = clamp(dt, 0, 0.1);

  while (remaining > 1e-6) {
    const slice = Math.min(1 / 60, remaining);
    const stepped = stepOnce(current, input, slice);
    current = stepped.state;
    events.push(...stepped.events);
    if (current.status !== 'playing') break;
    remaining -= slice;
  }

  return { state: current, events };
}
