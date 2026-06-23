CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivering', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_format" AS ENUM('generic', 'slack', 'discord', 'mattermost');--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"report_id" text,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"format" "webhook_format" DEFAULT 'generic' NOT NULL,
	"secret" text NOT NULL,
	"severities" "report_severity"[] DEFAULT '{}'::report_severity[] NOT NULL,
	"category_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "max_webhooks" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhooks_workspace_idx" ON "webhooks" USING btree ("workspace_id");