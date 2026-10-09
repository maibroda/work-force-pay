/**
 * Rehearses a restore: loads a backup into a scratch database, runs the ledger integrity check on it, compares it with
 * the live database, and drops the scratch database. It never writes to, or restores over, the live database.
 *
 *   npm run db:restore-check -- backups/workforcepay-20261009-101500.dump
 *
 * Exit 0: the backup restores, its ledger is no worse than live's, and its row counts match the live database.
 * Exit 3: it restores and checks out, but the live database has changed since (take a fresh backup to compare).
 * Exit 1: the restore failed, or the restored ledger has integrity findings that live does not.
 *
 * Restoring for real after a disaster is a deliberate human act, done into an empty database:
 *   createdb <name> && pg_restore --no-owner -d <name> <file>
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseUrl, restoreInto, sql, withDatabase } from "./_pg";

interface Summary {
  organization: string;
  ok: boolean;
  census: Record<string, number>;
  reconciliations: Array<{ name: string; difference: number }>;
  findings: number;
}

/**
 * Runs the integrity check as its own process against `url`, so it reads that database and no other. The check exits 1
 * when it has findings (that is not a failure to run); anything else non-zero is.
 */
function check(url: string): Summary[] {
  const r = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/ledger-check.ts", "--json"], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (r.status !== 0 && r.status !== 1) throw new Error(`The ledger check could not run (exit ${r.status}): ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return JSON.parse(r.stdout.replace(/^[^[]*/, "")) as Summary[];
}

function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error("Give the path of a backup file: npm run db:restore-check -- backups/<file>.dump");
  const live = process.env.DATABASE_URL;
  if (!live) throw new Error("DATABASE_URL is not set.");
  const c = parseUrl(live);
  const scratch = `${c.database}_restore_check`;
  if (scratch === c.database) throw new Error("Refusing: the scratch database would be the live one.");

  sql(c, "postgres", `DROP DATABASE IF EXISTS "${scratch}"`);
  sql(c, "postgres", `CREATE DATABASE "${scratch}"`);
  let exit = 0;
  try {
    console.log(`Restoring ${path.basename(file)} into scratch database "${scratch}"…`);
    restoreInto(c, file, scratch);
    console.log("Restored. Checking the ledger in the restored copy…");
    const restored = check(withDatabase(live, scratch));
    const current = check(live);

    let differ = 0;
    for (const r of restored) {
      const now = current.find((x) => x.organization === r.organization);
      const diffs = Object.entries(r.census).filter(([k, v]) => (now?.census[k] ?? -1) !== v);
      // The restored copy may be no *worse* than live: findings that already exist in live come across with the data.
      if (now && r.findings > now.findings) {
        console.log(`✘ ${r.organization}: the restored ledger has ${r.findings} integrity finding(s), live has ${now.findings}.`);
        exit = 1;
      } else if (diffs.length) {
        differ++;
        console.log(`≠ ${r.organization}: restored copy differs from live in ${diffs.map(([k, v]) => `${k} ${v} vs ${now?.census[k] ?? "—"}`).join(", ")}`);
      } else
        console.log(
          `✔ ${r.organization}: ${r.findings ? `same ${r.findings} finding(s) as live` : "ledger consistent"}, row counts match live (${Object.entries(r.census).map(([k, v]) => `${k} ${v}`).join(", ")})`,
        );
    }
    if (exit === 0 && differ) exit = 3;
    console.log(exit === 0 ? "\nRestore rehearsal passed." : exit === 3 ? "\nThe backup restores and checks out, but live has changed since it was taken." : "\nRestore rehearsal FAILED.");
  } finally {
    sql(c, "postgres", `DROP DATABASE IF EXISTS "${scratch}"`);
    console.log(`Scratch database "${scratch}" dropped.`);
  }
  process.exit(exit);
}

try {
  main();
} catch (e) {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
}
