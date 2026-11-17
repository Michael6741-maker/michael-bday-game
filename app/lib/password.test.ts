import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, isPasswordHash, omitPassword, passwordMatches } from './password';

describe('password hashing', () => {
  it('stores a sha256 digest, not the typed password', async () => {
    const hashed = await hashPassword('test');
    assert.equal(isPasswordHash(hashed), true);
    assert.equal(hashed, 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    assert.equal(hashed.includes('test'), false);
  });

  it('matches a hash and a legacy plaintext row', async () => {
    const hashed = await hashPassword('secret-pass');
    assert.equal(await passwordMatches(hashed, 'secret-pass'), true);
    assert.equal(await passwordMatches(hashed, 'wrong'), false);
    assert.equal(await passwordMatches('legacy-plain', 'legacy-plain'), true);
    assert.equal(await passwordMatches('legacy-plain', 'nope'), false);
    assert.equal(await passwordMatches(undefined, 'legacy-plain'), false);
  });

  it('removes the password before a profile is saved', () => {
    const session = omitPassword({ username: 'Gem', password: 'secret-pass', totalCoins: 1 });
    assert.equal('password' in session, false);
    assert.equal(session.username, 'Gem');
    assert.equal(session.totalCoins, 1);
  });
});
