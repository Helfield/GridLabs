ALTER TABLE "users" ADD COLUMN "api_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_api_token_unique" UNIQUE("api_token");