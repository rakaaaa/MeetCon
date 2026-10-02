import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("migrate: DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  max: 2,
  connectionTimeoutMillis: 10_000,
  application_name: "meetcon-migrate",
});

const fail = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`migrate failed: ${message}`);
  if (/password authentication failed/i.test(message)) {
    console.error(
      "Hint: POSTGRES_PASSWORD in .env.production must match the password in DATABASE_URL. " +
        "If you changed the password after the first deploy, reset the postgres volume or restore the old password.",
    );
  }
  process.exit(1);
};

const directory = join(dirname(fileURLToPath(import.meta.url)), "migrations");

try {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(74839201)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    if (files.length === 0) {
      throw new Error(`no .sql files in ${directory}`);
    }
    for (const name of files) {
      const sql = await readFile(join(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== checksum) {
          throw new Error(`Applied migration changed: ${name}`);
        }
        console.log(`Skip ${name} (already applied)`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name, checksum) VALUES($1,$2)", [name, checksum]);
        await client.query("COMMIT");
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(74839201)").catch(() => undefined);
    client.release();
  }
  await pool.end();
} catch (error) {
  fail(error);
}
