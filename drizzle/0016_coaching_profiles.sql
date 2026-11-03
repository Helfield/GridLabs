-- Paid coaching: the intake profile a member fills in after they've bought the
-- 1-on-1 package, and their coach reads before the first session.
-- Same DDL as the coaching block in src/db/ensure-schema.ts, which applies this
-- on boot; whichever of the two runs second is a no-op.
CREATE TABLE IF NOT EXISTS "coaching_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL UNIQUE REFERENCES "users"("id"),
  "name" text NOT NULL,
  "email" text NOT NULL,
  "sr_band" text NOT NULL,
  "dr_band" text NOT NULL,
  "experience" text NOT NULL,
  "classes" jsonb NOT NULL,
  "goal" text NOT NULL,
  "setup_link" text,
  "video" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
