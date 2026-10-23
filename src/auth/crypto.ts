import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

const jwtKey = new TextEncoder().encode(env.AUTH_JWT_SECRET);
const dummyPasswordHash = await argon2.hash(randomBytes(32).toString('hex'));

export interface AccessTokenClaims {
  userId: string;
  tokenVersion: number;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) {
    await argon2.verify(dummyPasswordHash, password);
    return false;
  }

  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createAccessToken(userId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({ tokenVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.AUTH_ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(jwtKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, jwtKey, { algorithms: ['HS256'] });
  if (
    typeof payload.sub !== 'string'
    || typeof payload.tokenVersion !== 'number'
    || !Number.isInteger(payload.tokenVersion)
  ) {
    throw new Error('Invalid access token claims');
  }
  return { userId: payload.sub, tokenVersion: payload.tokenVersion };
}
