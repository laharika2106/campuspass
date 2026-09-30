import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull(),
  role: text('role', {enum:['student','organizer']}).notNull().default('student'), createdAt: text('created_at').notNull(),
});
export const events = sqliteTable('events', {
  id: text('id').primaryKey(), title: text('title').notNull(), description: text('description').notNull(),
  category: text('category').notNull(), club: text('club').notNull(), venue: text('venue').notNull(),
  startsAt: text('starts_at').notNull(), endsAt: text('ends_at').notNull(), capacity: integer('capacity').notNull(),
  ownerId: text('owner_id').notNull().references(()=>users.id), sample: integer('sample').notNull().default(0), createdAt: text('created_at').notNull(),
}, t=>[index('idx_events_starts').on(t.startsAt),index('idx_events_owner').on(t.ownerId),check('capacity_positive',sql`${t.capacity} > 0`)]);
export const bookings = sqliteTable('bookings', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull().references(()=>events.id),
  userId: text('user_id').notNull().references(()=>users.id), code: text('code').notNull(),
  status: text('status',{enum:['confirmed','checked_in','cancelled']}).notNull().default('confirmed'),
  createdAt: text('created_at').notNull(), checkedInAt: text('checked_in_at'),
}, t=>[uniqueIndex('idx_booking_event_user').on(t.eventId,t.userId),uniqueIndex('idx_booking_code').on(t.code),index('idx_bookings_user').on(t.userId),index('idx_bookings_event_status').on(t.eventId,t.status)]);
