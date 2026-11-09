'use client';

import Link from 'next/link';
import type { AvatarItem, User } from '../lib/types';
import {
  AVATAR_SHOP_HREF,
  AVATAR_STUDIO_HREF,
  DEFAULT_SKIN_COLOR,
  getEquippedAvatarItems,
} from '../lib/avatarItems';
import Avatar3DViewer from './Avatar3DViewer';

/**
 * 3D avatar on menu screens, with shop and studio as real links (MIE-44).
 *
 * Do not wrap this in a <button>. OrbitControls need the pointer; a parent
 * button turns the rig into a flat poster that only navigates.
 */
export default function AvatarMenuPreview({
  user,
  catalog,
}: {
  user: User | null;
  catalog: AvatarItem[];
}) {
  const layers = user ? getEquippedAvatarItems(user, catalog) : {};
  const skinColor = user?.skinColor ?? DEFAULT_SKIN_COLOR;

  return (
    <div className="flex flex-col items-center w-full">
      <div className="rounded-2xl p-3 bg-purple-50 ring-2 ring-purple-200 w-full flex justify-center">
        <Avatar3DViewer layers={layers} skinColor={skinColor} enableRotation />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Link
          href={AVATAR_SHOP_HREF}
          className="inline-flex min-h-[40px] items-center px-4 rounded-full bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700"
        >
          Customize Avatar
        </Link>
        <Link
          href={AVATAR_STUDIO_HREF}
          className="inline-flex min-h-[40px] items-center px-4 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
        >
          Avatar Studio
        </Link>
      </div>
    </div>
  );
}
