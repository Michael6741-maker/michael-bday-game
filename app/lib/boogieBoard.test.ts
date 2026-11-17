import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANE_LIMIT,
  PLAYER_HALF_WIDTH,
  STARTING_LIVES,
  createRun,
  playerInHole,
  stepRun,
  type RunEvent,
  type RunState,
  type SteerInput,
} from './boogieBoard';

const IDLE: SteerInput = { left: false, right: false };

function runFrames(
  state: RunState,
  frames: number,
  input: SteerInput = IDLE,
  beforeStep?: (state: RunState) => RunState,
  stop?: (state: RunState, events: RunEvent[]) => boolean
): { state: RunState; events: RunEvent[] } {
  const events: RunEvent[] = [];
  let current = state;
  for (let i = 0; i < frames; i++) {
    if (beforeStep) current = beforeStep(current);
    const stepped = stepRun(current, input, 1 / 60);
    current = stepped.state;
    events.push(...stepped.events);
    if (current.status !== 'playing') break;
    if (stop?.(current, events)) break;
  }
  return { state: current, events };
}

test('a new run starts with 3 lives and no waves survived', () => {
  const run = createRun(() => 0.5);
  assert.equal(run.lives, STARTING_LIVES);
  assert.equal(run.lives, 3);
  assert.equal(run.survived, 0);
  assert.equal(run.status, 'playing');
  assert.equal(run.playerX, 0);
  assert.equal(run.waves.length, 1);
});

test('steering moves the rider and stops at the edge of the lane', () => {
  let state = createRun(() => 0.5);
  const right = runFrames(state, 180, { left: false, right: true });
  assert.equal(right.state.playerX, LANE_LIMIT);

  state = createRun(() => 0.5);
  const left = runFrames(state, 180, { left: true, right: false });
  assert.equal(left.state.playerX, -LANE_LIMIT);

  const cancelled = runFrames(createRun(() => 0.5), 60, { left: true, right: true });
  assert.equal(cancelled.state.playerX, 0);
});

test('passing through the hole increments the survived counter and keeps the life', () => {
  const state = createRun(() => 0.5);
  const hole = state.waves[0];
  assert.ok(playerInHole(0, hole));

  const result = runFrames(state, 900, IDLE, undefined, (current) => current.survived >= 1);
  const cleared = result.events.filter((event) => event.type === 'cleared');

  assert.equal(cleared.length, 1);
  assert.equal(result.state.survived, 1);
  assert.equal(result.state.lives, 3);
  assert.equal(result.events.some((event) => event.type === 'missed'), false);
});

test('a cleared wave is not counted twice', () => {
  const first = runFrames(createRun(() => 0.5), 900, IDLE, undefined, (current) => current.survived >= 1);
  assert.equal(first.state.survived, 1);

  const extra = runFrames(first.state, 20);
  const cleared = extra.events.filter((event) => event.type === 'cleared');
  assert.equal(cleared.length, 0);
  assert.equal(extra.state.survived, 1);
  assert.equal(extra.state.lives, 3);
});

test('hitting the wave outside the hole drops a life and does not count as survived', () => {
  const state = createRun(() => 0);
  state.playerX = LANE_LIMIT;
  assert.equal(playerInHole(state.playerX, state.waves[0]), false);

  const result = runFrames(state, 900, IDLE, undefined, (current) => current.lives < STARTING_LIVES);
  const missed = result.events.filter((event) => event.type === 'missed');

  assert.equal(missed[0]?.type, 'missed');
  if (missed[0]?.type === 'missed') assert.equal(missed[0].lives, 2);
  assert.equal(result.state.lives, 2);
  assert.equal(result.state.survived, 0);
});

test('overlapping the wall at the edge of the hole is a miss', () => {
  const state = createRun(() => 0.5);
  const hole = state.waves[0];
  state.playerX = hole.holeCenterX + hole.holeHalfWidth;
  assert.equal(playerInHole(state.playerX, hole), false);

  const result = runFrames(state, 900, IDLE, undefined, (current) => current.lives < STARTING_LIVES);
  assert.equal(result.state.lives, 2);
  assert.equal(result.state.survived, 0);
});

test('leaving the hole while the wave is on the board costs a life', () => {
  let state = createRun(() => 0.5);
  let missed = false;

  for (let i = 0; i < 900 && state.status === 'playing'; i++) {
    const wave = state.waves.find((item) => item.result === 'pending' && item.id === 1);
    if (wave) {
      const front = wave.z - wave.thickness / 2;
      const back = wave.z + wave.thickness / 2;
      const overlapping = front <= 0.85 && back >= -0.75;
      state = {
        ...state,
        playerX: overlapping ? LANE_LIMIT : wave.holeCenterX,
      };
    }
    const stepped = stepRun(state, IDLE, 1 / 60);
    state = stepped.state;
    if (stepped.events.some((event) => event.type === 'missed')) {
      missed = true;
      break;
    }
  }

  assert.equal(missed, true);
  assert.equal(state.lives, 2);
  assert.equal(state.survived, 0);
});

test('the run ends at 0 lives and stays there', () => {
  const state = createRun(() => 0);
  state.playerX = LANE_LIMIT;

  const result = runFrames(state, 1800);
  assert.equal(result.state.status, 'gameover');
  assert.equal(result.state.lives, 0);
  assert.equal(result.state.survived, 0);
  assert.equal(result.events.filter((event) => event.type === 'missed').length, 3);
  assert.equal(result.events.filter((event) => event.type === 'gameover').length, 1);

  const frozen = stepRun(result.state, { left: true, right: false }, 1);
  assert.equal(frozen.state.lives, 0);
  assert.equal(frozen.state.survived, 0);
  assert.equal(frozen.state.status, 'gameover');
  assert.equal(frozen.events.length, 0);
});

test('threading several holes only increments the survived counter', () => {
  let n = 0;
  const samples = [0.15, 0.82, 0.33, 0.67, 0.08, 0.91];
  const state = createRun(() => samples[n++ % samples.length]);

  const result = runFrames(state, 1600, IDLE, (current) => {
    const next = current.waves
      .filter((wave) => wave.result === 'pending')
      .sort((a, b) => a.z - b.z)[0];
    if (!next) return current;
    return { ...current, playerX: clampToLane(next.holeCenterX) };
  });

  assert.ok(result.state.survived >= 2, `expected several clears, got ${result.state.survived}`);
  assert.equal(result.state.lives, 3);
  assert.equal(result.events.some((event) => event.type === 'missed'), false);
  assert.equal(
    result.events.filter((event) => event.type === 'cleared').length,
    result.state.survived
  );
});

function clampToLane(x: number): number {
  return Math.min(LANE_LIMIT, Math.max(-LANE_LIMIT, x));
}

test('the rider fits in a fresh hole when lined up with its center', () => {
  const state = createRun(() => 0.2);
  const wave = state.waves[0];
  assert.ok(wave.holeHalfWidth > PLAYER_HALF_WIDTH);
  assert.equal(playerInHole(wave.holeCenterX, wave), true);
  assert.equal(playerInHole(wave.holeCenterX + wave.holeHalfWidth, wave), false);
});
