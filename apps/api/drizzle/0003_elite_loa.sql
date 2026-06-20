ALTER TABLE "reports" ADD COLUMN "workspace_id" text;--> statement-breakpoint
-- HAND-ADDED backfill: derive workspace via stream → category before NOT NULL.
UPDATE "reports" r SET "workspace_id" = c."workspace_id"
  FROM "streams" s
  JOIN "categories" c ON c."id" = s."category_id"
  WHERE s."id" = r."stream_id";--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_workspace_received_idx" ON "reports" USING btree ("workspace_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);
