CREATE TABLE IF NOT EXISTS "discord_leaderboard_posts" (
	"track" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"content_hash" text,
	"leaders" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
