/**
 * Ledger integrity check, from the command line.
 *
 *   npm run ledger:check              # every organization in DATABASE_URL; exit 1 if any ERROR
 *   npm run ledger:check -- --json    # machine-readable, for comparing a restored copy with the live database
 *
 * Reads only. Run it before and after every finance migration and in CI. See src/server/services/ledger-integrity.ts.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { checkAllOrganizations, type IntegrityReport } from "../src/server/services/ledger-integrity";

const SHOW_PER_CHECK = 5;

function print(r: IntegrityReport) {
  // an organization with nothing posted and nothing to reconcile needs one line, not a block
  if (r.ok && !r.census.journals && !r.census.invoices && !r.census.vendorBills) {
    console.log(`\n✔ ${r.organization}  — nothing posted`);
    return;
  }
  const errors = r.findings.filter((f) => f.severity === "ERROR").length;
  const warns = r.findings.length - errors;
  console.log(`\n${r.ok ? "✔" : "✘"} ${r.organization}  — ${errors} error(s), ${warns} warning(s)`);
  console.log(`  census: ${Object.entries(r.census).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  for (const rec of r.reconciliations)
    console.log(`  ${Math.abs(rec.difference) < 0.005 ? "=" : "≠"} ${rec.name}: subledger ${rec.subledger.toFixed(2)} · ledger ${rec.control.toFixed(2)} · difference ${rec.difference.toFixed(2)}`);
  const byCheck = new Map<string, typeof r.findings>();
  for (const f of r.findings) byCheck.set(f.check, [...(byCheck.get(f.check) ?? []), f]);
  for (const [check, list] of byCheck) {
    console.log(`  ${list[0].severity} ${check} ×${list.length}`);
    for (const f of list.slice(0, SHOW_PER_CHECK)) console.log(`      ${f.ref ? `[${f.ref}] ` : ""}${f.message}`);
    if (list.length > SHOW_PER_CHECK) console.log(`      … and ${list.length - SHOW_PER_CHECK} more`);
  }
}

async function main() {
  const reports = await checkAllOrganizations();
  if (process.argv.includes("--json")) console.log(JSON.stringify(reports.map((r) => ({ organization: r.organization, ok: r.ok, census: r.census, reconciliations: r.reconciliations, findings: r.findings.length })), null, 2));
  else reports.forEach(print);
  const failed = reports.filter((r) => !r.ok);
  if (!process.argv.includes("--json")) console.log(`\n${reports.length} organization(s) checked; ${failed.length} with errors.`);
  await db.$disconnect();
  process.exit(failed.length ? 1 : 0);
}
main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(2);
});
