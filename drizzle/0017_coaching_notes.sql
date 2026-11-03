-- Paid coaching: what a coach writes down about a driver. One kind of note, read
-- by the driver and the staff alike, and only ever added or removed rather than
-- edited.
-- Same DDL as the coaching block in src/db/ensure-schema.ts, which applies this
-- on boot; whichever of the two runs second is a no-op.
CREATE TABLE IF NOT EXISTS "coaching_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "author_id" integer NOT NULL REFERENCES "users"("id"),
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "coaching_notes_user_idx" ON "coaching_notes" ("user_id");
