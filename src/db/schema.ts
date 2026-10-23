import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const userStatus = pgEnum('users_status', ['active', 'suspended', 'deleted']);
export const authProvider = pgEnum('auth_provider', ['google', 'facebook', 'phone', 'email']);
export const authTokenPurpose = pgEnum('auth_token_purpose', ['email_verification', 'password_reset']);

// Keep identity and user profile data separate as the account model grows.
// Phone verification and recovery tables will be introduced with the auth module.
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  userName: varchar('user_name', { length: 100 }).notNull(),
  username: varchar('username', { length: 30 }).notNull().unique(),
  bio: text('bio'),
  homeCity: varchar('home_city', { length: 100 }),
  status: userStatus('status').notNull().default('active'),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authIdentities = pgTable('auth_identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: authProvider('provider').notNull(),
  providerUserId: varchar('provider_user_id', { length: 255 }),
  email: varchar('email', { length: 320 }),
  phone: varchar('phone', { length: 16 }),
  passwordHash: text('password_hash'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('auth_identities_provider_user_id_unique').on(table.provider, table.providerUserId),
  uniqueIndex('auth_identities_provider_email_unique').on(table.provider, table.email),
  uniqueIndex('auth_identities_provider_phone_unique').on(table.provider, table.phone),
  index('auth_identities_user_id_idx').on(table.userId),
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: varchar('refresh_token_hash', { length: 64 }).notNull().unique(),
  deviceInfo: text('device_info'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),
]);

export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  identityId: uuid('identity_id').notNull().references(() => authIdentities.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  purpose: authTokenPurpose('purpose').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('auth_tokens_identity_purpose_idx').on(table.identityId, table.purpose),
]);

export const authAuditLogs = pgTable('auth_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  event: varchar('event', { length: 64 }).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('auth_audit_logs_user_created_idx').on(table.userId, table.createdAt),
]);

export const authRateLimits = pgTable('auth_rate_limits', {
  keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
  attempts: integer('attempts').notNull(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
}, (table) => [
  index('auth_rate_limits_window_started_idx').on(table.windowStartedAt),
]);
