/** Ad-hoc inspection of the kept test cluster: node scripts/inspect-db.mjs "SQL..." */
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = new EmbeddedPostgres({
  databaseDir: path.join(ROOT, ".pgtest", "data"),
  user: "postgres",
  password: "postgres",
  port: 55439,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});

const sql = process.argv[2] ?? "SELECT 1";
await server.start();
const c = new pg.Client({ host: "127.0.0.1", port: 55439, user: "postgres", password: "postgres", database: "sarai_test" });
await c.connect();
try {
  const res = await c.query(sql);
  console.log(JSON.stringify(res.rows, null, 2));
} catch (e) {
  console.error(e.message);
} finally {
  await c.end();
  await server.stop();
}
