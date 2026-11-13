/**
 * The legal-hold checks that the deletions call (governance step 3a). Kept apart from the schedule screens so the three deletions that exist (erasing a former employee, anonymising stale
 * candidates, purging old survey answers) can import it without importing each other. Read-only: a hold is placed and released in retention-schedule.ts.
 */
import { iso } from "@/lib/dates";
import { holdBlocks, holdBlocksPerson, type HoldLike, type RetentionCategory } from "@/lib/retention-schedule";
import { db } from "./_base";

/** The live (not released) holds of one company. */
export async function liveHolds(orgId: string): Promise<HoldLike[]> {
  const rows = await db.retentionHold.findMany({ where: { organizationId: orgId, releasedAt: null }, select: { id: true, scope: true, employeeId: true, category: true, releasedAt: true, reviewOn: true } });
  return rows.map((r) => ({ ...r, reviewOn: iso(r.reviewOn) }));
}

/** True when a live hold covers this former employee as a whole person (they are about to be erased). */
export async function employeeHeld(orgId: string, employeeId: string): Promise<boolean> {
  return holdBlocksPerson(await liveHolds(orgId), employeeId) !== null;
}

/** True when a live hold covers a whole category of record that is not about one person (applicants, survey answers). */
export async function categoryHeld(orgId: string, category: RetentionCategory): Promise<boolean> {
  return holdBlocks(await liveHolds(orgId), { category }) !== null;
}
