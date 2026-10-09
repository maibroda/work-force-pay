/**
 * Stamps the accounting period on journals posted before periods existed.
 *
 *   npm run ledger:backfill-periods
 *
 * Idempotent and additive: it creates any missing financial years (all periods open) and sets each unstamped journal's
 * period once. The database allows exactly that one update on an unstamped journal and nothing else, so no posted
 * amount, date or account can change. Back up first (npm run db:backup) as with any change to the books.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { backfillJournalPeriods } from "../src/server/services/periods";

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true }, orderBy: { code: "asc" } });
  for (const o of orgs) {
    const n = await backfillJournalPeriods(o.id);
    console.log(`${o.name}: ${n} journal(s) stamped with their accounting period.`);
  }
  await db.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
