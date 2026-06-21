import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { serverTimestamp } from './columns.js';

/**
 * Billing accounts — the billing/tenancy entity that owns one or more
 * workspaces. Exported as `billingAccounts`/`BillingAccount` to stay distinct
 * from better-auth's provider `accounts`/`Account` (DB table `account`), which
 * is a different concept (a user's linked credentials). DB table name is
 * `accounts` (plural), separate from better-auth's `account` (singular).
 *
 * This is the seam between the OSS substrate and the SaaS. Self-host has exactly
 * one implicit billing account (created at first-run setup) with all limits
 * `null` (= unlimited). The cloud creates one per signup and writes the limit
 * columns from the active subscription via its (private) billing webhook — OSS
 * code only ever *reads* these columns, never Stripe.
 *
 * Limit columns are nullable; `null` means "no limit", so the OSS default is
 * unlimited and enforcement is a pure no-op until a value is set. Billing
 * columns (stripe_customer_id, subscription_status, …) are intentionally NOT
 * declared here — a cloud-owned migration adds them to the same table, keeping
 * the AGPL schema free of billing concerns.
 */
export const billingAccounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Max age (days) of retained reports; null = keep forever. */
  retentionDays: integer('retention_days'),
  /** Max distinct member users across the account's workspaces; null = unlimited. */
  maxSeats: integer('max_seats'),
  /** Max workspaces under this account; null = unlimited. */
  maxWorkspaces: integer('max_workspaces'),
  createdAt: serverTimestamp('created_at'),
});

export type BillingAccount = typeof billingAccounts.$inferSelect;
export type NewBillingAccount = typeof billingAccounts.$inferInsert;
