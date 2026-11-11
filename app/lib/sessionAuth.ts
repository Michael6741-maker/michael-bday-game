import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { functions, getFirebaseAuth } from './firebase';

export function isMissingCallable(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: string }).code)
    : '';
  return code === 'functions/not-found' || code === 'not-found';
}

export async function signInWithSessionToken(token: string): Promise<void> {
  await signInWithCustomToken(getFirebaseAuth(), token);
}

/** Ask the server to check the password. Returns null when that function is not deployed yet. */
export async function requestPasswordSession(
  username: string,
  password: string,
): Promise<{ token: string; username: string } | null> {
  try {
    const fn = httpsCallable<
      { username: string; password: string },
      { token: string; username: string }
    >(functions, 'startPasswordSession');
    const result = await fn({ username, password });
    return result.data;
  } catch (error) {
    if (isMissingCallable(error)) return null;
    throw error;
  }
}

/** Ask the server to create the account. Returns null when that function is not deployed yet. */
export async function requestPlayerRegistration(
  username: string,
  password: string,
  avatarId: number,
): Promise<{ token: string; username: string } | null> {
  try {
    const fn = httpsCallable<
      { username: string; password: string; avatarId: number },
      { token: string; username: string }
    >(functions, 'registerPlayer');
    const result = await fn({ username, password, avatarId });
    return result.data;
  } catch (error) {
    if (isMissingCallable(error)) return null;
    throw error;
  }
}
