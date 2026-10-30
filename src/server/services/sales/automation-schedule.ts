/**
 * The one thing the deal code needs from the automation engine: when a deal enters a stage, queue the rules for that stage (each as a run with a due time), and
 * cancel what was still waiting from the stage it left. Kept apart from the engine so deals and pipelines can use it without importing it (the engine imports them).
 * Queuing never fails a deal move: it only writes rows, and a rule's action happens later, in the engine.
 */
import type { Tx } from "../_base";

const MINUTE = 60_000;

export async function scheduleStageEntry(tx: Tx, orgId: string, opportunityId: string, stageId: string, historyId: string, now = new Date()) {
  // leaving a stage stops the rules still waiting from earlier entries of this deal
  await tx.crmAutomationRun.updateMany({
    where: { organizationId: orgId, opportunityId, status: "PENDING", NOT: { entryKey: historyId }, rule: { trigger: "STAGE_ENTRY" } },
    data: { status: "CANCELLED", finishedAt: now, error: "The deal left the stage before this was due." },
  });
  const rules = await tx.crmAutomationRule.findMany({ where: { organizationId: orgId, trigger: "STAGE_ENTRY", stageId, enabled: true }, select: { id: true, delayMinutes: true } });
  if (!rules.length) return;
  // one run for each rule, deal and entry: the database ignores a second
  await tx.crmAutomationRun.createMany({
    data: rules.map((r) => ({ organizationId: orgId, ruleId: r.id, opportunityId, entryKey: historyId, runAt: new Date(now.getTime() + r.delayMinutes * MINUTE) })),
    skipDuplicates: true,
  });
}
