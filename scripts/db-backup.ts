/**
 * Backs up the database to backups/<database>-<timestamp>.dump (PostgreSQL custom format).
 *
 *   npm run db:backup
 *   npm run db:backup -- --out some/other/folder
 *
 * Run it before every migration, then prove it is usable with `npm run db:restore-check -- <file>`. A backup that has
 * never been restored is a hope, not a backup. The dump holds every table, including personal and payroll data, so
 * keep it somewhere access-controlled; the backups/ folder is git-ignored.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { dumpTo, mode, parseUrl } from "./_pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const c = parseUrl(url);
  const outIdx = process.argv.indexOf("--out");
  const dir = path.resolve(outIdx > 0 ? process.argv[outIdx + 1] : "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const file = path.join(dir, `${c.database}-${stamp}.dump`);
  await dumpTo(c, file);
  const size = fs.statSync(file).size;
  if (size < 1024) {
    fs.unlinkSync(file);
    throw new Error(`The backup was only ${size} bytes, so it was discarded — something went wrong.`);
  }
  console.log(`Backed up "${c.database}" (${mode()} tools) to ${file} — ${(size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Prove it restores:  npm run db:restore-check -- "${file}"`);
}
main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
