'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { Card, NavPill } from '../components/ui';
import MenuBackground from '../components/MenuBackground';
import {
  STARTING_LIVES,
  type CameraMode,
  type SteerInput,
} from '../lib/boogieBoard';

const BoogieBoardCanvas = dynamic(() => import('./BoogieBoardCanvas'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-sky-300 text-slate-800 font-medium">
      Loading the ocean…
    </div>
  ),
});

type Phase = 'ready' | 'playing' | 'over';

interface Banner {
  id: number;
  tone: 'miss' | 'clear';
  text: string;
}

/**
 * Same camera control before the run and while playing.
 * The choice is kept when the run ends and the player starts again.
 */
function CameraModeControl({
  mode,
  onChange,
  tone,
}: {
  mode: CameraMode;
  onChange: (mode: CameraMode) => void;
  tone: 'card' | 'hud';
}) {
  const hud = tone === 'hud';
  return (
    <div>
      <p className={hud ? 'text-[11px] uppercase tracking-wide text-white/70 px-1 mb-1' : 'text-sm font-medium text-gray-700 mb-2'}>
        Camera
      </p>
      <div
        role="radiogroup"
        aria-label="Camera"
        data-testid="camera-mode"
        data-mode={mode}
        className={
          hud
            ? 'grid grid-cols-2 gap-1 rounded-2xl bg-black/45 backdrop-blur-md p-1 ring-1 ring-white/20'
            : 'grid grid-cols-2 gap-1 rounded-2xl bg-gray-100 p-1'
        }
      >
        {(
          [
            ['first', 'First person'],
            ['third', 'Third person'],
          ] as const
        ).map(([value, label]) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`camera-${value}`}
              onClick={() => onChange(value)}
              className={`min-h-[44px] rounded-xl px-3 text-sm font-semibold transition-all ${
                hud
                  ? active
                    ? 'bg-white text-slate-900'
                    : 'text-white/85 hover:bg-white/10'
                  : active
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow'
                    : 'text-gray-600 hover:bg-white'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TouchSteer({
  inputRef,
  disabled,
}: {
  inputRef: React.RefObject<SteerInput>;
  disabled: boolean;
}) {
  const [held, setHeld] = useState({ left: false, right: false });

  const setDir = (dir: 'left' | 'right', down: boolean) => {
    if (disabled) return;
    inputRef.current[dir] = down;
    setHeld((current) => ({ ...current, [dir]: down }));
  };

  const buttonClass =
    'w-16 h-16 rounded-2xl bg-black/40 backdrop-blur-md ring-1 ring-white/30 text-white text-2xl font-bold flex items-center justify-center select-none touch-none';

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[env(safe-area-inset-bottom)]">
      {(
        [
          ['left', '←', 'left-4'],
          ['right', '→', 'right-4'],
        ] as const
      ).map(([dir, glyph, side]) => (
        <button
          key={dir}
          type="button"
          aria-label={dir === 'left' ? 'Steer left' : 'Steer right'}
          disabled={disabled}
          className={`${buttonClass} pointer-events-auto absolute bottom-4 ${side} ${
            held[dir] ? 'bg-white/40 scale-95' : ''
          }`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDir(dir, true);
          }}
          onPointerUp={() => setDir(dir, false)}
          onPointerCancel={() => setDir(dir, false)}
          onLostPointerCapture={() => setDir(dir, false)}
        >
          {glyph}
        </button>
      ))}
    </div>
  );
}

export default function BoogieBoardPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('ready');
  const [cameraMode, setCameraMode] = useState<CameraMode>('third');
  const [lives, setLives] = useState(STARTING_LIVES);
  const [survived, setSurvived] = useState(0);
  const [runId, setRunId] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const inputRef = useRef<SteerInput>({ left: false, right: false });
  const runToken = useRef(0);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 900);
    return () => window.clearTimeout(id);
  }, [banner]);

  useEffect(() => {
    if (phase === 'ready') return;
    document.body.classList.add('game-page');
    return () => document.body.classList.remove('game-page');
  }, [phase]);

  useEffect(() => {
    const input = inputRef.current;
    if (phase !== 'playing') {
      input.left = false;
      input.right = false;
      return;
    }

    const setKey = (code: string, down: boolean, event: KeyboardEvent) => {
      if (code === 'ArrowLeft' || code === 'KeyA') {
        input.left = down;
        event.preventDefault();
      } else if (code === 'ArrowRight' || code === 'KeyD') {
        input.right = down;
        event.preventDefault();
      }
    };
    const onDown = (event: KeyboardEvent) => setKey(event.code, true, event);
    const onUp = (event: KeyboardEvent) => setKey(event.code, false, event);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      input.left = false;
      input.right = false;
    };
  }, [phase]);

  const beginRun = () => {
    runToken.current += 1;
    inputRef.current.left = false;
    inputRef.current.right = false;
    setLives(STARTING_LIVES);
    setSurvived(0);
    setBanner(null);
    setRunId(runToken.current);
    setPhase('playing');
  };

  const onMiss = useCallback((nextLives: number, token: number) => {
    if (token !== runToken.current) return;
    setLives(nextLives);
    setBanner({ id: Date.now(), tone: 'miss', text: 'Missed the hole' });
  }, []);

  const onClear = useCallback((nextSurvived: number, token: number) => {
    if (token !== runToken.current) return;
    setSurvived(nextSurvived);
    setBanner({ id: Date.now(), tone: 'clear', text: 'Wave cleared' });
  }, []);

  const onGameOver = useCallback((nextSurvived: number, token: number) => {
    if (token !== runToken.current) return;
    setLives(0);
    setSurvived(nextSurvived);
    setBanner(null);
    setPhase('over');
  }, []);

  if (phase === 'ready') {
    return (
      <MenuBackground className="min-h-screen flex flex-col items-center justify-center p-4 py-20">
        <div className="absolute top-4 left-4">
          <NavPill onClick={() => router.push('/')} ariaLabel="Back to game picker">
            <span aria-hidden className="text-base leading-none">←</span>
            <span>Games</span>
          </NavPill>
        </div>

        <Card className="w-full max-w-md p-6 sm:p-8 animate-page-in">
          <div className="text-center mb-6">
            <p className="text-5xl mb-3" aria-hidden>
              🏄
            </p>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-800 tracking-tight">
              Boogie Board
            </h1>
            <p className="text-sm sm:text-base text-gray-600 mt-2">
              Steer through the hole in every wave.
            </p>
          </div>

          <CameraModeControl mode={cameraMode} onChange={setCameraMode} tone="card" />

          <button
            type="button"
            data-testid="play-button"
            onClick={beginRun}
            className="mt-6 w-full font-semibold min-h-[52px] py-3 px-6 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg hover:from-purple-700 hover:to-pink-700 hover:scale-[1.02] active:scale-95 transition-all"
          >
            ▶ Play
          </button>

          <div className="mt-5 pt-4 border-t border-gray-200 text-xs text-gray-600 space-y-1">
            <p>You start with {STARTING_LIVES} lives. The wave counter goes up each time you make it through a hole.</p>
            <p>Missing the hole — hitting the wave beside it — costs a life.</p>
            <p>Arrow keys or A and D to steer. Touch screens get arrow buttons.</p>
          </div>
        </Card>
      </MenuBackground>
    );
  }

  return (
    <div
      className="fixed inset-0 select-none bg-sky-300 touch-none"
      data-testid="boogie-play"
      data-phase={phase}
      data-camera-mode={cameraMode}
    >
      <BoogieBoardCanvas
        runId={runId}
        cameraMode={cameraMode}
        inputRef={inputRef}
        onMiss={onMiss}
        onClear={onClear}
        onGameOver={onGameOver}
      />

      {banner && (
        <div
          className={`pointer-events-none absolute top-28 left-1/2 z-40 -translate-x-1/2 rounded-full px-5 py-2 text-sm font-bold text-white shadow-glow-sm animate-pop-in ${
            banner.tone === 'miss' ? 'bg-rose-600/90' : 'bg-emerald-600/90'
          }`}
        >
          {banner.text}
        </div>
      )}

      <div className="absolute top-3 left-3 right-3 z-40 flex items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-2">
          <NavPill onClick={() => router.push('/')} ariaLabel="Back to game picker">
            <span aria-hidden className="text-base leading-none">←</span>
            <span>Games</span>
          </NavPill>
          <CameraModeControl mode={cameraMode} onChange={setCameraMode} tone="hud" />
        </div>

        <div className="flex flex-col items-end gap-2" aria-live="polite">
          <div
            data-testid="lives"
            data-lives={lives}
            className="rounded-full bg-black/45 backdrop-blur-md px-4 min-h-[44px] flex items-center gap-2 ring-1 ring-white/20 text-white font-semibold"
          >
            <span>Lives {lives}</span>
            <span aria-hidden className="tracking-tight">
              {Array.from({ length: STARTING_LIVES }, (_, index) => (index < lives ? '❤️' : '🖤')).join('')}
            </span>
          </div>
          <div
            data-testid="waves-survived"
            data-survived={survived}
            className="rounded-full bg-black/45 backdrop-blur-md px-4 min-h-[44px] flex items-center gap-2 ring-1 ring-white/20 text-white"
          >
            <span className="text-[11px] uppercase tracking-wide text-white/70">Survived</span>
            <span className="font-extrabold tabular-nums text-lg">{survived}</span>
          </div>
        </div>
      </div>

      {phase === 'playing' && (
        <>
          <div className="pointer-events-none absolute bottom-24 left-1/2 z-40 w-[min(24rem,calc(100%-8rem))] -translate-x-1/2 rounded-full bg-black/45 backdrop-blur-md px-4 py-2 text-center text-xs sm:text-sm text-white/90 ring-1 ring-white/20">
            Steer through the glowing hole. <b>Arrows</b> or <b>A/D</b>.
          </div>
          <TouchSteer inputRef={inputRef} disabled={false} />
        </>
      )}

      {phase === 'over' && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 p-4">
          <div className="bg-white rounded-3xl shadow-glow p-8 text-center max-w-sm w-full animate-pop-in">
            <p className="text-5xl mb-3" aria-hidden>
              🌊
            </p>
            <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Wiped out</h2>
            <p className="text-sm text-gray-600 mb-1">
              You survived {survived} {survived === 1 ? 'wave' : 'waves'}.
            </p>
            <p className="text-xs text-gray-400 mb-5">Lives 0. The camera stays where you set it.</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                data-testid="play-again"
                onClick={beginRun}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold min-h-[48px] rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all"
              >
                Play again
              </button>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="w-full bg-gray-100 text-gray-800 font-semibold min-h-[48px] rounded-xl hover:bg-gray-200 transition-all"
              >
                Back to games
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
