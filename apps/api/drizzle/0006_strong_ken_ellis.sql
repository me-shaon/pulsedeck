ALTER TABLE "categories" ADD COLUMN "label_source" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "streams" ADD COLUMN "label_source" text DEFAULT 'auto' NOT NULL;