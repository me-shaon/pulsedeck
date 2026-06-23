import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { serverTimestamp } from './columns.js';

/**
 * Billing accounts — the billing/tenancy entity that owns one or more
 * workspaces. Exported as `billingAccounts`/`BillingAccount` and stored in the
 * DB table `billing_accounts`, kept unambiguously distinct from better-auth's
 * provider table `account` (`authAccounts`/`AuthAccount`), which is a different
 * concept (a user's linked credentials).
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
export const billingAccounts = pgTable('billing_accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Max age (days) of retained reports; null = keep forever. */
  retentionDays: integer('retention_days'),
  /** Max distinct member users across the account's workspaces; null = unlimited. */
  maxSeats: integer('max_seats'),
  /** Max workspaces under this account; null = unlimited. */
  maxWorkspaces: integer('max_workspaces'),
  /** Max outbound webhooks across the account's workspaces; null = unlimited. */
  maxWebhooks: integer('max_webhooks'),
  createdAt: serverTimestamp('created_at'),
});

export type BillingAccount = typeof billingAccounts.$inferSelect;
export type NewBillingAccount = typeof billingAccounts.$inferInsert;
