'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, setCurrentUser as persistCurrentUser } from './lib/auth';
import { getUserData, subscribeToAvatarItems } from './lib/firestore';
import { AvatarItem, User } from './lib/types';
import { mergeAvatarCatalog } from './lib/avatarItems';
import { GAMES, GameDefinition } from './lib/games';
import { Card, PageHero } from './components/ui';
import TopNav from './components/TopNav';
import MenuBackground from './components/MenuBackground';
import AvatarMenuPreview from './components/AvatarMenuPreview';

/**
 * Game Picker (root)
 *
 * Landing screen listing every game in the app. Each game owns its own menu
 * route. The player's 3D avatar, shop, and Avatar Studio stay on this screen
 * so nobody has to know a secret URL (MIE-44).
 */
export default function GamePicker() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [avatarCatalog, setAvatarCatalog] = useState<AvatarItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const user = getCurrentUser();

    if (!user) {
      router.push('/login');
      return;
    }

    // Defer cached localStorage hydration so React's effect lint does not flag a
    // synchronous state cascade (same pattern as the Platform Drop menu).
    queueMicrotask(() => {
      if (cancelled) return;
      setCurrentUser(user);
      setIsLoading(false);
    });

    // ...then refresh from Firestore so currency pills stay in sync across devices.
    getUserData(user.username)
      .then((fresh) => {
        if (!cancelled && fresh) {
          setCurrentUser(fresh);
          persistCurrentUser(fresh);
        }
      })
      .catch((err) => {
        console.warn('[game-picker] could not refresh profile', err);
      });

    const unsubAvatars = subscribeToAvatarItems((items) => {
      if (!cancelled) setAvatarCatalog(mergeAvatarCatalog(items));
    });

    return () => {
      cancelled = true;
      unsubAvatars();
    };
  }, [router]);

  const handleLogout = () => {
    setCurrentUser(null);
    router.push('/login');
  };

  const handlePick = (game: GameDefinition) => {
    if (game.status !== 'live') return;
    router.push(game.href);
  };

  if (isLoading) {
    return null; // Prevent flash of empty state
  }

  return (
    <MenuBackground className="min-h-screen flex flex-col items-center justify-center p-4 py-20 sm:py-24">
      <TopNav user={currentUser} onLogout={handleLogout} transparent />

      <main className="w-full max-w-md md:max-w-4xl mx-2 sm:mx-4 my-auto animate-page-in">
        <PageHero
          title="Choose Your Game"
          subtitle={currentUser ? `Welcome back, ${currentUser.username}!` : undefined}
        />

        {/* 3D avatar + Studio stay on the first screen after login (MIE-44). */}
        <div className="bg-white rounded-3xl shadow-glow p-4 sm:p-5 mb-6 flex flex-col sm:flex-row items-center gap-4">
          <AvatarMenuPreview user={currentUser} catalog={avatarCatalog} />
          <div className="text-center sm:text-left">
            <h2 className="text-lg font-extrabold text-gray-800">Your 3D avatar</h2>
            <p className="text-sm text-gray-600 mt-1">
              Drag the character to turn them around. Avatar Studio is where you design clothes.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {GAMES.map((game) => {
            const isLive = game.status === 'live';
            return (
              <Card
                key={game.id}
                interactive={isLive}
                className={`overflow-hidden ${isLive ? '' : 'opacity-60'}`}
              >
                <button
                  type="button"
                  onClick={() => handlePick(game)}
                  disabled={!isLive}
                  aria-label={isLive ? `Play ${game.title}` : `${game.title} — not yet available`}
                  className="w-full text-left disabled:cursor-not-allowed"
                >
                  {/* Banner */}
                  <div
                    className={`bg-gradient-to-r ${game.gradient} px-6 py-10 flex items-center justify-center`}
                  >
                    <span className="text-6xl drop-shadow-lg" aria-hidden>
                      {game.emoji}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <h2 className="text-xl sm:text-2xl font-extrabold text-gray-800 tracking-tight">
                        {game.title}
                      </h2>
                      {!isLive && (
                        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">
                          Soon
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{game.tagline}</p>
                    {isLive && (
                      <p className="mt-4 text-sm font-semibold text-purple-700">Play →</p>
                    )}
                  </div>
                </button>
              </Card>
            );
          })}
        </div>

        <p className="text-center text-white/80 text-xs mt-6 drop-shadow">
          Your coins, gems, and avatar are shared across every game.
        </p>
      </main>
    </MenuBackground>
  );
}
