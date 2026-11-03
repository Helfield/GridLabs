-- Paid coaching: the two packages on offer and who holds which one.
-- Same DDL as the coaching block in src/db/ensure-schema.ts, which applies
-- this on boot; whichever of the two runs second is a no-op.
CREATE TABLE IF NOT EXISTS "coaching_products" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "blurb" text NOT NULL,
  "unlocks" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
-- Seeded rather than created empty: the gate needs these rows on the first
-- request after a deploy. ON CONFLICT DO NOTHING so a coach's edit of the
-- wording is never undone by a re-run.
INSERT INTO "coaching_products" ("slug", "name", "blurb", "unlocks") VALUES
  ('one_to_one', '1-on-1 coaching', 'One coach, assigned to you from the hours you mark as free.', 'Your own profile: an intake form, your coach''s notes on it, and a time booked with them.'),
  ('live_events', 'Live events', 'The club''s live sessions on track together.', 'The live schedule: which nights the club runs, and what is coming up.')
ON CONFLICT ("slug") DO NOTHING;
CREATE TABLE IF NOT EXISTS "coaching_entitlements" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "product_id" integer NOT NULL REFERENCES "coaching_products"("id"),
  "source" text DEFAULT 'manual' NOT NULL,
  "external_id" text,
  "expires_at" timestamp,
  "granted_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "coaching_entitlements_user_product_idx" ON "coaching_entitlements" ("user_id","product_id");
