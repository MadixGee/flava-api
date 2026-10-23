import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { sendAuthTokenEmail } from '../auth/email.js';
import {
  createAccessToken,
  createOpaqueToken,
  hashPassword,
  hashToken,
  verifyAccessToken,
  verifyPassword,
} from '../auth/crypto.js';
import { enforceAuthRateLimit } from '../auth/rate-limit.js';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { authAuditLogs, authIdentities, authTokens, sessions, users } from '../db/schema.js';

const emailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
});
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  deviceInfo: z.string().trim().max(500).optional(),
});
const emailOnlySchema = z.object({ email: emailSchema });
const tokenSchema = z.object({ token: z.string().min(20).max(512) });
const passwordResetSchema = z.object({
  token: z.string().min(20).max(512),
  newPassword: z.string().min(8).max(128),
});
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(512) });
const logoutSchema = refreshSchema;
const genericRecoveryMessage = 'If an account exists for this email, check your inbox for instructions.';
const invalidCredentialsMessage = 'Invalid email or password.';
const signupInvalidMessage = 'Please check email or password invalid';
const signupConflictMessage = 'Email already registered';
const genericEmailResponseDelayMs = 250;

type EmailPurpose = 'email_verification' | 'password_reset';

function invalidRequest(): never {
  throw Object.assign(new Error('Invalid request body'), { statusCode: 400 });
}

function unauthorized(): never {
  throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
}

function parseBody<T>(schema: z.ZodType<T>, request: Request): T {
  const result = schema.safeParse(request.body);
  if (!result.success) invalidRequest();
  return result.data;
}

function rateLimitForEmail(request: Request, email: string, action: string, max: number, windowMs: number) {
  return Promise.all([
    enforceAuthRateLimit(`ip:${request.ip}:${action}`, max, windowMs),
    enforceAuthRateLimit(`email:${email}:${action}`, max, windowMs),
  ]);
}

function rateLimitForIp(request: Request, action: string, max: number, windowMs: number) {
  return enforceAuthRateLimit(`ip:${request.ip}:${action}`, max, windowMs);
}

async function genericEmailResponse(
  startedAt: number,
  reply: Response,
) {
  const remainingDelay = genericEmailResponseDelayMs - (Date.now() - startedAt);
  if (remainingDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  }
  return reply.status(202).json({ message: genericRecoveryMessage });
}

async function createOneTimeToken(identityId: string, purpose: EmailPurpose) {
  const token = createOpaqueToken();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(
        eq(authTokens.identityId, identityId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
      ));
    await tx.insert(authTokens).values({
      identityId,
      tokenHash: hashToken(token),
      purpose,
      expiresAt: new Date(now.getTime() + env.AUTH_EMAIL_TOKEN_TTL_MINUTES * 60_000),
    });
  });
  return token;
}

async function recordAuditEvent(
  userId: string | null,
  event: string,
  request: Request,
): Promise<void> {
  await db.insert(authAuditLogs).values({
    userId,
    event,
    ipAddress: request.ip,
  });
}

async function issueSession(
  userId: string,
  tokenVersion: number,
  deviceInfo: string | undefined,
): Promise<{ accessToken: string; refreshToken: string }> {
  const refreshToken = createOpaqueToken();
  await db.insert(sessions).values({
    userId,
    refreshTokenHash: hashToken(refreshToken),
    deviceInfo: deviceInfo ?? null,
  });
  const accessToken = await createAccessToken(userId, tokenVersion);
  return { accessToken, refreshToken };
}

async function authenticate(request: Request, _reply: Response, next: NextFunction): Promise<void> {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match?.[1]) unauthorized();

  let claims;
  try {
    claims = await verifyAccessToken(match[1]);
  } catch {
    unauthorized();
  }

  const [user] = await db
    .select({ id: users.id, tokenVersion: users.tokenVersion, status: users.status })
    .from(users)
    .where(eq(users.id, claims.userId))
    .limit(1);
  if (!user || user.status !== 'active' || user.tokenVersion !== claims.tokenVersion) unauthorized();
  request.auth = { userId: user.id, tokenVersion: user.tokenVersion };
  next();
}

async function issueEmailToken(
  identityId: string,
  email: string,
  purpose: EmailPurpose,
): Promise<void> {
  const token = await createOneTimeToken(identityId, purpose);
  void sendAuthTokenEmail(email, purpose, token).catch((error: unknown) => {
    const details = error instanceof Error
      ? { name: error.name, code: 'code' in error ? error.code : undefined }
      : { name: 'UnknownError' };
    logger.error({ err: details }, 'Failed to deliver authentication email');
  });
}

interface RouteDefinition {
  middleware?: RequestHandler[];
  handler: (request: Request, reply: Response) => Promise<unknown>;
}

export function createAuthRouter(): Router {
  const router = Router();
  const mount = (method: 'get' | 'post' | 'delete', path: string, definition: RouteDefinition) => {
    router[method](path, ...(definition.middleware ?? []), async (request, reply) => {
      await definition.handler(request, reply);
    });
  };

  mount('post', '/auth/email/signup', {
    handler: async (request, reply) => {
      const parsedBody = signupSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).json({ error: signupInvalidMessage });
      }
      const { email, password } = parsedBody.data;
      await rateLimitForEmail(request, email, 'email-signup', 5, 60 * 60_000);

      const [existing] = await db
        .select({ id: authIdentities.id, verifiedAt: authIdentities.verifiedAt })
        .from(authIdentities)
        .where(and(eq(authIdentities.provider, 'email'), eq(authIdentities.email, email)))
        .limit(1);

      if (existing) {
        return reply.status(409).json({ error: signupConflictMessage });
      }

      try {
        const passwordHash = await hashPassword(password);
        const identityId = await db.transaction(async (tx) => {
          const [user] = await tx.insert(users).values({
            userName: 'New listener',
            username: `listener_${createOpaqueToken().slice(0, 12)}`,
          }).returning({ id: users.id });
          if (!user) throw new Error('Failed to create user');
          const [identity] = await tx.insert(authIdentities).values({
            userId: user.id,
            provider: 'email',
            email,
            providerUserId: email,
            passwordHash,
          }).returning({ id: authIdentities.id });
          if (!identity) throw new Error('Failed to create auth identity');
          return { id: identity.id, userId: user.id };
        });
        await issueEmailToken(identityId.id, email, 'email_verification');
        await recordAuditEvent(identityId.userId, 'email_signup', request);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
          return reply.status(409).json({ error: signupConflictMessage });
        }
        throw error;
      }

      return reply.status(200).json({ message: 'User created successfully' });
    },
  });

  mount('post', '/auth/email/login', {
    handler: async (request, reply) => {
      const { email, password, deviceInfo } = parseBody(loginSchema, request);
      await rateLimitForEmail(request, email, 'email-login', 10, 15 * 60_000);

      const [identity] = await db
        .select({
          id: authIdentities.id,
          userId: authIdentities.userId,
          passwordHash: authIdentities.passwordHash,
          verifiedAt: authIdentities.verifiedAt,
        })
        .from(authIdentities)
        .where(and(eq(authIdentities.provider, 'email'), eq(authIdentities.email, email)))
        .limit(1);

      const passwordMatches = await verifyPassword(identity?.passwordHash ?? null, password);
      if (!identity || !identity.verifiedAt || !passwordMatches) {
        await recordAuditEvent(identity?.userId ?? null, 'email_login_failed', request);
        throw Object.assign(new Error(invalidCredentialsMessage), { statusCode: 401 });
      }

      const [user] = await db
        .select({ id: users.id, tokenVersion: users.tokenVersion, status: users.status })
        .from(users)
        .where(eq(users.id, identity.userId))
        .limit(1);
      if (!user || user.status !== 'active') {
        throw Object.assign(new Error(invalidCredentialsMessage), { statusCode: 401 });
      }

      const tokenPair = await issueSession(user.id, user.tokenVersion, deviceInfo);
      await recordAuditEvent(user.id, 'email_login', request);
      return reply.json(tokenPair);
    },
  });

  mount('post', '/auth/email/verify', {
    handler: async (request, reply) => {
      const { token } = parseBody(tokenSchema, request);
      await rateLimitForIp(request, 'email-verify', 10, 15 * 60_000);
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const [consumed] = await tx
          .update(authTokens)
          .set({ usedAt: now })
          .where(and(
            eq(authTokens.tokenHash, hashToken(token)),
            eq(authTokens.purpose, 'email_verification'),
            isNull(authTokens.usedAt),
            gt(authTokens.expiresAt, now),
          ))
          .returning({ identityId: authTokens.identityId });
        if (!consumed) return null;

        const [identity] = await tx
          .update(authIdentities)
          .set({ verifiedAt: now })
          .where(eq(authIdentities.id, consumed.identityId))
          .returning({ userId: authIdentities.userId });
        return identity ?? null;
      });

      if (!result) {
        throw Object.assign(new Error('Invalid or expired verification token'), { statusCode: 400 });
      }
      await recordAuditEvent(result.userId, 'email_verified', request);
      return reply.json({ message: 'Email verified.' });
    },
  });

  mount('post', '/auth/password/forgot', {
    handler: async (request, reply) => {
      const startedAt = Date.now();
      const { email } = parseBody(emailOnlySchema, request);
      await rateLimitForEmail(request, email, 'password-forgot', 3, 60 * 60_000);

      const [identity] = await db
        .select({ id: authIdentities.id, userId: authIdentities.userId })
        .from(authIdentities)
        .where(and(
          eq(authIdentities.provider, 'email'),
          eq(authIdentities.email, email),
          isNotNull(authIdentities.verifiedAt),
        ))
        .limit(1);

      if (identity) {
        await issueEmailToken(identity.id, email, 'password_reset');
        await recordAuditEvent(identity.userId, 'password_reset_requested', request);
      }
      return genericEmailResponse(startedAt, reply);
    },
  });

  mount('post', '/auth/password/reset', {
    handler: async (request, reply) => {
      const { token, newPassword } = parseBody(passwordResetSchema, request);
      await rateLimitForIp(request, 'password-reset', 5, 60 * 60_000);
      const passwordHash = await hashPassword(newPassword);
      const now = new Date();

      const userId = await db.transaction(async (tx) => {
        const [consumed] = await tx
          .update(authTokens)
          .set({ usedAt: now })
          .where(and(
            eq(authTokens.tokenHash, hashToken(token)),
            eq(authTokens.purpose, 'password_reset'),
            isNull(authTokens.usedAt),
            gt(authTokens.expiresAt, now),
          ))
          .returning({ identityId: authTokens.identityId });
        if (!consumed) return null;

        const [identity] = await tx
          .update(authIdentities)
          .set({ passwordHash })
          .where(eq(authIdentities.id, consumed.identityId))
          .returning({ userId: authIdentities.userId });
        if (!identity) return null;

        await tx
          .update(users)
          .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: now })
          .where(eq(users.id, identity.userId));
        await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(and(eq(sessions.userId, identity.userId), isNull(sessions.revokedAt)));
        await tx
          .update(authTokens)
          .set({ usedAt: now })
          .where(and(
            eq(authTokens.identityId, consumed.identityId),
            eq(authTokens.purpose, 'password_reset'),
            isNull(authTokens.usedAt),
          ));
        return identity.userId;
      });

      if (!userId) {
        throw Object.assign(new Error('Invalid or expired reset token'), { statusCode: 400 });
      }
      await recordAuditEvent(userId, 'password_reset', request);
      return reply.json({ message: 'Password reset. Please sign in again.' });
    },
  });

  mount('post', '/auth/refresh', {
    handler: async (request, reply) => {
      const { refreshToken } = parseBody(refreshSchema, request);
      await rateLimitForIp(request, 'refresh', 30, 15 * 60_000);
      const oldHash = hashToken(refreshToken);
      const nextRefreshToken = createOpaqueToken();
      const now = new Date();

      const refreshed = await db.transaction(async (tx) => {
        const [session] = await tx
          .select({
            id: sessions.id,
            userId: users.id,
            tokenVersion: users.tokenVersion,
            status: users.status,
            createdAt: sessions.createdAt,
          })
          .from(sessions)
          .innerJoin(users, eq(sessions.userId, users.id))
          .where(and(eq(sessions.refreshTokenHash, oldHash), isNull(sessions.revokedAt)))
          .for('update')
          .limit(1);
        if (
          !session
          || session.status !== 'active'
          || session.createdAt.getTime() + env.AUTH_REFRESH_TOKEN_TTL_DAYS * 86_400_000 <= now.getTime()
        ) return null;

        const [rotated] = await tx
          .update(sessions)
          .set({ refreshTokenHash: hashToken(nextRefreshToken), lastUsedAt: now })
          .where(and(eq(sessions.id, session.id), eq(sessions.refreshTokenHash, oldHash), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        if (!rotated) return null;
        return { userId: session.userId, tokenVersion: session.tokenVersion };
      });

      if (!refreshed) {
        throw Object.assign(new Error('Invalid or expired refresh token'), { statusCode: 401 });
      }
      return reply.json({
        accessToken: await createAccessToken(refreshed.userId, refreshed.tokenVersion),
        refreshToken: nextRefreshToken,
      });
    },
  });

  mount('post', '/auth/logout', {
    handler: async (request, reply) => {
      const { refreshToken } = parseBody(logoutSchema, request);
      await rateLimitForIp(request, 'logout', 30, 15 * 60_000);
      const [revoked] = await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.refreshTokenHash, hashToken(refreshToken)), isNull(sessions.revokedAt)))
        .returning({ userId: sessions.userId });
      if (revoked) {
        await recordAuditEvent(revoked.userId, 'logout', request);
      }
      return reply.json({ message: 'Logged out.' });
    },
  });

  mount('post', '/auth/logout-all', {
    middleware: [authenticate],
    handler: async (request, reply) => {
    if (!request.auth) unauthorized();
    const { userId } = request.auth;
    await Promise.all([
      rateLimitForIp(request, 'logout-all', 5, 60 * 60_000),
      enforceAuthRateLimit(`user:${userId}:logout-all`, 5, 60 * 60_000),
    ]);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: now })
        .where(eq(users.id, userId));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    });
    await recordAuditEvent(userId, 'logout_all', request);
    return reply.json({ message: 'Logged out of all sessions.' });
    },
  });

  mount('get', '/users/me/sessions', {
    middleware: [authenticate],
    handler: async (request, reply) => {
    if (!request.auth) unauthorized();
    const { userId } = request.auth;
    const activeSessions = await db
      .select({
        id: sessions.id,
        deviceInfo: sessions.deviceInfo,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .where(and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.createdAt, new Date(Date.now() - env.AUTH_REFRESH_TOKEN_TTL_DAYS * 86_400_000)),
      ))
      .orderBy(sessions.lastUsedAt);
    return reply.json({ sessions: activeSessions });
    },
  });

  mount('delete', '/users/me/sessions/:id', {
    middleware: [authenticate],
    handler: async (request, reply) => {
    if (!request.auth) unauthorized();
    const { userId } = request.auth;
    await Promise.all([
      rateLimitForIp(request, 'session-revoke', 20, 60 * 60_000),
      enforceAuthRateLimit(`user:${userId}:session-revoke`, 20, 60 * 60_000),
    ]);
    const sessionId = z.string().uuid().safeParse(request.params.id);
    if (!sessionId.success) invalidRequest();
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(sessions.id, sessionId.data),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
      ));
    return reply.status(204).end();
    },
  });

  return router;
}
