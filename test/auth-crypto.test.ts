import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import {
  createAccessToken,
  createOpaqueToken,
  hashPassword,
  hashToken,
  verifyAccessToken,
  verifyPassword,
} from '../src/auth/crypto.js';

describe('authentication cryptography', () => {
  it('hashes passwords with a one-way hash and verifies only the right password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).not.toContain('correct horse battery staple');
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'incorrect password')).resolves.toBe(false);
  });

  it('uses opaque refresh tokens and stores only a digest', () => {
    const token = createOpaqueToken();

    expect(token).toHaveLength(43);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toBe(token);
  });

  it('issues and verifies access tokens with the expected claims', async () => {
    const userId = randomUUID();
    const token = await createAccessToken(userId, 7);

    await expect(verifyAccessToken(token)).resolves.toEqual({ userId, tokenVersion: 7 });
  });

  it('rejects modified token payloads', async () => {
    const token = await createAccessToken(randomUUID(), 0);
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) throw new Error('Malformed test token');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    claims.sub = randomUUID();
    const modifiedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');

    await expect(verifyAccessToken(`${header}.${modifiedPayload}.${signature}`)).rejects.toThrow();
  });

  it('rejects expired access tokens', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 120;
    const expired = await new SignJWT({ tokenVersion: 0 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(randomUUID())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 60)
      .sign(new TextEncoder().encode(env.AUTH_JWT_SECRET));

    await expect(verifyAccessToken(expired)).rejects.toThrow();
  });
});
