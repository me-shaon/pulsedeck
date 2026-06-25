ALTER TABLE "reports" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "reports_stream_active_received_idx" ON "reports" USING btree ("stream_id","received_at" DESC NULLS LAST) WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "reports_stream_archived_idx" ON "reports" USING btree ("stream_id","archived_at" DESC NULLS LAST);