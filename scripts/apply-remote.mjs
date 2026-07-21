/**
 * Apply SARAI ERP schema + seed to a REMOTE Postgres database (Supabase).
 *
 * Runs supabase/migrations/*.sql in order, then supabase/seed.sql.
 * Each file runs inside its own transaction (rolls back on error).
 * The test harness and *.test.sql files are intentionally NEVER applied.
 *
 * Usage (PowerShell):
 *   $env:SARAI_DB_URL = "postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres"
 *   node scripts/apply-remote.mjs
 *
 * Add --force to run even if SARAI tables already exist (may error on
 * duplicate objects — intended only for a fresh database).
 */
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORCE = process.argv.includes("--force");
const DB_URL = process.env.SARAI_DB_URL;

if (!DB_URL) {
  console.error("SARAI_DB_URL is not set. Aborting.");
  process.exit(1);
}

function rel(p) {
  return path.relative(ROOT, p).replaceAll("\\", "/");
}

async function migrationFiles() {
  const dir = path.join(ROOT, "supabase", "migrations");
  const entries = await readdir(dir);
  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f));
}

async function main() {
  const client = new pg.Client({
    connectionString: DB_URL,
    // Supabase requires TLS; the pooler cert chain isn't in Node's store.
    ssl: { rejectUnauthorized: false },
    // fail fast if the host/credentials are wrong rather than hang
    connectionTimeoutMillis: 20000,
    statement_timeout: 120000,
  });

  console.log("[connect] connecting to the database ...");
  await client.connect();

  try {
    const who = await client.query(
      "select current_database() as db, current_user as usr, version() as ver"
    );
    console.log(`[connect] OK — db=${who.rows[0].db} user=${who.rows[0].usr}`);

    // Safety: refuse to re-apply onto a database that already has our schema.
    const exists = await client.query("select to_regclass('public.accounts') as t");
    if (exists.rows[0].t && !FORCE) {
      console.error(
        "\n[abort] public.accounts already exists — this database is not fresh.\n" +
          "        Re-running the migrations would fail on duplicate objects.\n" +
          "        Use --force only if you know the objects are absent."
      );
      process.exit(2);
    }

    const files = [...(await migrationFiles()), path.join(ROOT, "supabase", "seed.sql")];

    for (const file of files) {
      const sql = await readFile(file, "utf8");
      const t = Date.now();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`[apply] OK   ${rel(file)} (${Date.now() - t} ms)`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`[apply] FAIL ${rel(file)}`);
        console.error(`         ${err.message}`);
        if (err.position) console.error(`         at position ${err.position}`);
        if (err.where) console.error(`         WHERE: ${err.where}`);
        throw new Error(`stopped at ${rel(file)} — nothing after this was applied`);
      }
    }

    // quick smoke check
    const chk = await client.query(`
      select
        (select count(*) from public.accounts)          as accounts,
        (select count(*) from public.products)          as products,
        (select count(*) from public.product_variants)  as variants,
        (select count(*) from public.expense_categories) as expense_categories
    `);
    console.log(
      `\n[verify] seeded rows — accounts=${chk.rows[0].accounts}, products=${chk.rows[0].products}, ` +
        `variants=${chk.rows[0].variants}, expense_categories=${chk.rows[0].expense_categories}`
    );
    console.log("\n[done] schema + seed applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
