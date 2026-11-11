// One-way password hashes. The browser session never keeps the account password
// on the saved profile (see auth.ts).

const HASH_PREFIX = 'sha256:';

export function isPasswordHash(stored: string | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(HASH_PREFIX);
}

/** SHA-256 hex digest prefixed so legacy plaintext rows are recognizable. */
export async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${HASH_PREFIX}${hex}`;
}

/**
 * Check a typed password against a stored hash.
 * Rows created before hashing still hold the original password; those match once,
 * and new accounts only store the hash.
 */
export async function passwordMatches(stored: string | undefined, input: string): Promise<boolean> {
  if (!stored || !input) return false;
  if (isPasswordHash(stored)) return stored === await hashPassword(input);
  return stored === input;
}

/** Drop the password field before a profile is shown or saved in the browser. */
export function omitPassword<T extends { password?: string }>(user: T): Omit<T, 'password'> {
  const copy = { ...user };
  delete copy.password;
  return copy;
}
