CREATE TABLE IF NOT EXISTS "reference_laps" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"track" text NOT NULL,
	"car" text NOT NULL,
	"label" text NOT NULL,
	"data" jsonb NOT NULL,
	"lap_time_seconds" real,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"track" text NOT NULL,
	"car" text NOT NULL,
	"reference_lap_id" integer,
	"lap_time_seconds" real,
	"sector_1_seconds" real,
	"sector_2_seconds" real,
	"sector_3_seconds" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	"discord_id" text NOT NULL,
	"discord_username" text NOT NULL,
	"discord_avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reference_laps" ADD CONSTRAINT "reference_laps_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_reference_lap_id_reference_laps_id_fk" FOREIGN KEY ("reference_lap_id") REFERENCES "public"."reference_laps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
