/**
 * SARAI ERP — SQL test runner.
 *
 * Boots a REAL PostgreSQL cluster (embedded-postgres, no Docker required),
 * applies the Supabase shim (auth schema + JWT GUC emulation), every
 * migration in supabase/migrations/, seed.sql, then runs each
 * supabase/tests/*.test.sql file on a fresh connection.
 *
 * Usage:
 *   npm run db:test            apply + run all tests, then tear down
 *   npm run db:test:keep       keep the cluster files for inspection
 *   node scripts/run-sql-tests.mjs --only phase1
 */
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PGDIR = path.join(ROOT, ".pgtest", "data");
const PORT = Number(process.env.SARAI_TEST_PG_PORT ?? 55439);
const DB = "sarai_test";
const KEEP = process.argv.includes("--keep");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

const connCfg = {
  host: "127.0.0.1",
  port: PORT,
  user: "postgres",
  password: "postgres",
  database: DB,
};

async function sqlFiles(dir, suffix = ".sql") {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => path.join(dir, f));
}

async function runFile(client, file) {
  const sql = await readFile(file, "utf8");
  await client.query(sql);
}

function rel(p) {
  return path.relative(ROOT, p).replaceAll("\\", "/");
}

async function main() {
  const t0 = Date.now();
  await rm(path.join(ROOT, ".pgtest"), { recursive: true, force: true });

  const server = new EmbeddedPostgres({
    databaseDir: PGDIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });

  let failed = 0;
  let passed = 0;
  try {
    console.log(`[setup] initialising PostgreSQL cluster on port ${PORT} ...`);
    await server.initialise();
    await server.start();

    // Windows initdb defaults to WIN1252; Pashto text requires UTF8.
    {
      const admin = new pg.Client({ ...connCfg, database: "postgres" });
      await admin.connect();
      await admin.query(
        `CREATE DATABASE ${DB} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`
      );
      await admin.end();
    }

    const setup = new pg.Client(connCfg);
    await setup.connect();
    try {
      const phases = [
        ["shim", await sqlFiles(path.join(ROOT, "supabase", "tests", "harness"))],
        ["migration", await sqlFiles(path.join(ROOT, "supabase", "migrations"))],
        ["seed", [path.join(ROOT, "supabase", "seed.sql")]],
      ];
      for (const [label, files] of phases) {
        for (const file of files) {
          const t = Date.now();
          try {
            await runFile(setup, file);
            console.log(`[${label}] OK   ${rel(file)} (${Date.now() - t} ms)`);
          } catch (err) {
            console.error(`[${label}] FAIL ${rel(file)}`);
            console.error(`         ${err.message}`);
            if (err.where) console.error(`         WHERE: ${err.where}`);
            throw new Error(`setup failed at ${rel(file)}`);
          }
        }
      }
    } finally {
      await setup.end();
    }

    let testFiles = await sqlFiles(path.join(ROOT, "supabase", "tests"), ".test.sql");
    if (ONLY) testFiles = testFiles.filter((f) => f.includes(ONLY));
    if (testFiles.length === 0) console.warn("[tests] no test files found");

    for (const file of testFiles) {
      const client = new pg.Client(connCfg);
      await client.connect();
      const t = Date.now();
      try {
        await runFile(client, file);
        passed++;
        console.log(`[test] PASS ${rel(file)} (${Date.now() - t} ms)`);
      } catch (err) {
        failed++;
        console.error(`[test] FAIL ${rel(file)}`);
        console.error(`       ${err.message}`);
        if (err.where) console.error(`       WHERE: ${err.where}`);
      } finally {
        await client.end();
      }
    }

    console.log(
      `\n[done] ${passed} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(1)} s total)`
    );
  } finally {
    try {
      await server.stop();
    } catch {
      /* already stopped */
    }
    if (!KEEP) {
      // Windows can hold file locks briefly after shutdown; retry.
      for (let i = 0; i < 5; i++) {
        try {
          await rm(path.join(ROOT, ".pgtest"), { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
