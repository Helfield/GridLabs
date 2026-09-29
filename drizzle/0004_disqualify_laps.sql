ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "excluded_reason" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "excluded_at" timestamp;
