CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"retention_days" integer,
	"max_seats" integer,
	"max_workspaces" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "account_id" text;--> statement-breakpoint
-- Backfill: any pre-existing workspaces are adopted by a single implicit
-- account (limits null = unlimited), preserving current behavior. No-op on a
-- fresh install (no workspaces) and on every test DB.
INSERT INTO "accounts" ("id", "name")
SELECT 'acc_legacy_default', 'Default Account'
WHERE EXISTS (SELECT 1 FROM "workspaces");--> statement-breakpoint
UPDATE "workspaces" SET "account_id" = 'acc_legacy_default' WHERE "account_id" IS NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
