-- Rename the billing/tenancy table from `accounts` to `billing_accounts` so it
-- is no longer one keystroke away from better-auth's credential table `account`
-- (singular). Data, the primary key, and the `workspaces.account_id` foreign key
-- all survive RENAME untouched; we rename the FK constraint too so its name
-- keeps matching the table (and matches what drizzle-kit would generate fresh).
ALTER TABLE "accounts" RENAME TO "billing_accounts";--> statement-breakpoint
ALTER TABLE "workspaces" RENAME CONSTRAINT "workspaces_account_id_accounts_id_fk" TO "workspaces_account_id_billing_accounts_id_fk";
