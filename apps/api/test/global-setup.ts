import pg from "pg";
import { runMigrations } from "../src/db/migrate";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://maestranze:maestranze@localhost:5432/maestranze_test";

export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  await runMigrations(TEST_DB);
}
