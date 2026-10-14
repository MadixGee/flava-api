import { pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const userStatus = pgEnum('users_status', ['active', 'suspended', 'deleted']);

// Keep identity and user profile data separate as the account model grows.
// Phone verification and recovery tables will be introduced with the auth module.
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  userName: varchar('user_name', { length: 100 }).notNull(),
  username: varchar('username', { length: 30 }).notNull().unique(),
  bio: text('bio'),
  homeCity: varchar('home_city', { length: 100 }),
  status: userStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
