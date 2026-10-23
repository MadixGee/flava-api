import { createHash } from 'node:crypto';
import { lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { authRateLimits } from '../db/schema.js';

let nextCleanupAt = 0;

export async function enforceAuthRateLimit(
  identity: string,
  limit: number,
  windowMilliseconds: number,
): Promise<void> {
  const nowMilliseconds = Date.now();
  if (nowMilliseconds >= nextCleanupAt) {
    nextCleanupAt = nowMilliseconds + 60 * 60_000;
    await db
      .delete(authRateLimits)
      .where(lt(authRateLimits.windowStartedAt, new Date(nowMilliseconds - 24 * 60 * 60_000)));
  }

  const keyHash = createHash('sha256').update(identity).digest('hex');
  const windowStartedAt = new Date(nowMilliseconds);
  const resetThreshold = new Date(windowStartedAt.getTime() - windowMilliseconds);
  const [bucket] = await db
    .insert(authRateLimits)
    .values({ keyHash, attempts: 1, windowStartedAt })
    .onConflictDoUpdate({
      target: authRateLimits.keyHash,
      set: {
        attempts: sql`CASE WHEN ${authRateLimits.windowStartedAt} <= ${resetThreshold} THEN 1 ELSE ${authRateLimits.attempts} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${authRateLimits.windowStartedAt} <= ${resetThreshold} THEN ${windowStartedAt} ELSE ${authRateLimits.windowStartedAt} END`,
      },
    })
    .returning({ attempts: authRateLimits.attempts });

  if (bucket && bucket.attempts > limit) {
    throw Object.assign(new Error('Too many requests. Try again later.'), { statusCode: 429 });
  }
}
