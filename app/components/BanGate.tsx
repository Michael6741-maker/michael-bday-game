'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout, USER_CHANGED_EVENT } from '../lib/auth';
import { checkPlayAccess, subscribeToBanStatus } from '../lib/firestore';
import { formatBanMessage, isBanStatusActive, type BanStatus } from '../lib/ban';
import MenuBackground from './MenuBackground';

const RECHECK_MS = 15_000;

/**
 * Blocks the app when the server says this account, or its observed network, is banned.
 * Children unmount, so hiding the message in devtools does not leave the game running.
 */
export default function BanGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<'boot' | 'open' | 'banned'>('boot');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    let watchedUser = '';
    let unsubBan: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;

    const showBan = (text: string, gen: number) => {
      if (cancelled || gen !== generation) return;
      setMessage(text);
      setPhase('banned');
    };

    const inspect = async () => {
      const gen = generation;
      const user = getCurrentUser();
      if (!user) {
        if (!cancelled && gen === generation) {
          setMessage('');
          setPhase('open');
        }
        return;
      }
      try {
        const result = await checkPlayAccess(user);
        if (cancelled || gen !== generation) return;
        if (result.banned) {
          showBan(result.message || formatBanMessage(result.reason || ''), gen);
          return;
        }
        setMessage('');
        setPhase('open');
      } catch (error) {
        console.warn('[ban] play access check failed', error);
        if (cancelled || gen !== generation) return;
        setMessage((current) => {
          if (current.startsWith('Error 600, you have been ban from this game (Reason: ')
            && !current.includes('play access could not be verified')) {
            return current;
          }
          return formatBanMessage('play access could not be verified');
        });
        setPhase('banned');
      }
    };

    const bind = () => {
      const user = getCurrentUser();
      const name = user?.username ?? '';
      // Home refreshes the cached profile and fires USER_CHANGED_EVENT.
      // That is the same account — don't flip back to "Checking account…".
      if (name && name === watchedUser) return;
      watchedUser = name;
      generation += 1;
      const gen = generation;
      unsubBan?.();
      unsubBan = undefined;
      if (!user) {
        setMessage('');
        setPhase('open');
        return;
      }
      setPhase((current) => (current === 'banned' ? current : 'boot'));
      unsubBan = subscribeToBanStatus(user.username, (status: BanStatus | null) => {
        if (cancelled || gen !== generation) return;
        if (isBanStatusActive(status) && status) {
          showBan(formatBanMessage(status.reason), gen);
          return;
        }
        void inspect();
      });
      void inspect();
    };

    bind();
    timer = setInterval(() => {
      if (getCurrentUser()) void inspect();
    }, RECHECK_MS);
    const onUser = () => bind();
    const onFocus = () => {
      if (getCurrentUser()) void inspect();
    };
    window.addEventListener(USER_CHANGED_EVENT, onUser);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      unsubBan?.();
      window.removeEventListener(USER_CHANGED_EVENT, onUser);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  if (phase === 'banned') {
    return (
      <MenuBackground className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-glow ring-1 ring-black/5 p-8 w-full max-w-md text-center">
          <p className="text-lg font-semibold text-gray-800" role="alert">
            {message}
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold min-h-[52px] py-3 px-6 rounded-xl hover:from-purple-700 hover:to-pink-700 transition"
          >
            Logout
          </button>
        </div>
      </MenuBackground>
    );
  }

  if (phase === 'boot') {
    return (
      <MenuBackground className="min-h-screen flex items-center justify-center p-4">
        <p className="text-white font-medium">Checking account…</p>
      </MenuBackground>
    );
  }

  return <>{children}</>;
}
