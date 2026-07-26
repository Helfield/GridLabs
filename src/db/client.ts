import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Railway (and most Postgres hosts) provide this as a single connection
// string env var. Locally, set it in .env to point at a local Postgres
// instance (see README.md for setup).
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set -- see README.md for setup.");
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
