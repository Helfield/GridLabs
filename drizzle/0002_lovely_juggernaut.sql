CREATE TABLE IF NOT EXISTS "promotion_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"track" text NOT NULL,
	"car_class" text,
	"lap_time_seconds" real NOT NULL,
	"current_reference_lap_id" integer NOT NULL,
	"current_reference_lap_time_seconds" real NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "reference_laps" ADD COLUMN IF NOT EXISTS "car_display" text;--> statement-breakpoint
ALTER TABLE "reference_laps" ADD COLUMN IF NOT EXISTS "auto_promoted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reference_laps" ADD COLUMN IF NOT EXISTS "source_session_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "data" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promotion_approvals" ADD CONSTRAINT "promotion_approvals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promotion_approvals" ADD CONSTRAINT "promotion_approvals_current_reference_lap_id_reference_laps_id_fk" FOREIGN KEY ("current_reference_lap_id") REFERENCES "public"."reference_laps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reference_laps" ADD CONSTRAINT "reference_laps_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;