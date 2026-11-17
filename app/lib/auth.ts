// Authentication utilities for user session management
// Uses localStorage to persist user session across page reloads

import { User } from './types';
import { omitPassword } from './password';

// LocalStorage key for current user session. The password is never written here.
const CURRENT_USER_KEY = 'platform_drop_current_user';
// In-memory only. Survives client-side navigation, cleared on logout and on refresh.
let sessionPassword = '';

/** Custom event name fired when login/logout updates the cached user. */
export const USER_CHANGED_EVENT = 'platform-drop-user-changed';

/** Notify client providers (e.g. PlayerSettingsProvider) that auth state changed. */
function notifyUserChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(USER_CHANGED_EVENT));
}

/**
 * Get the currently logged in user from localStorage
 * @returns The User object or null if not logged in
 */
export function getCurrentUser(): User | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const stored = localStorage.getItem(CURRENT_USER_KEY);
    if (!stored) return null;
    
    const parsed = JSON.parse(stored) as User;
    // Validate the user has required fields
    if (!parsed.username || typeof parsed.totalCoins !== 'number') return null;
    if (parsed.password) {
      const safe = omitPassword(parsed);
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safe));
      return safe;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Remember the password typed at login until logout or a full reload. Not stored. */
export function rememberSessionPassword(password: string): void {
  if (!password || password.startsWith('sha256:')) return;
  sessionPassword = password;
}

/** Password typed at login, if this page session still has it. */
export function getSessionPassword(): string {
  return sessionPassword;
}

export function setCurrentUser(user: User): void {
  if (typeof window === 'undefined') return;
  if (user.password && !user.password.startsWith('sha256:')) {
    rememberSessionPassword(user.password);
  }
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(omitPassword(user)));
  notifyUserChanged();
}

/**
 * Clear the current user session (logout)
 */
export function logout(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CURRENT_USER_KEY);
  sessionPassword = '';
  notifyUserChanged();
}

/**
 * Check if a user is currently logged in
 * @returns true if a user is logged in
 */
export function isLoggedIn(): boolean {
  return getCurrentUser() !== null;
}

/**
 * Update specific fields of the current user
 * Useful for updating stats without re-fetching from Firestore
 * @param updates - Partial user object with fields to update
 */
export function updateCurrentUser(updates: Partial<User>): void {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  
  const updatedUser = { ...currentUser, ...updates };
  setCurrentUser(updatedUser);
}
