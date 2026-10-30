CREATE TABLE IF NOT EXISTS "engineer_usage" (
  "user_id" integer PRIMARY KEY NOT NULL REFERENCES "users"("id"),
  "questions" integer NOT NULL
);
