import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { approveRequisition, createRequisition, rejectRequisition } from "@/server/services/recruitment";
import { isolatedOrg } from "../helpers";

// Founder-approved 2026-11-17 (docs/plans/internal-selection-plan.md, S7): the audit log carries ids, numbers and enums, never the words of a requisition's private justification, its decision
// note or its budget. The audit log is read by the administrators and the auditor, who are not meant to read what the justification says (it can name people), and it is append-only, so
// the words must never be written. The requisition itself still holds them, for the people who may read it.

const JUSTIFICATION = "PRIVATE-JUSTIFICATION replace a leaver quietly before he finds out";

async function setup() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const boss = t.ctx("COMPANY_ADMIN");
  const raise = (title = "Site Supervisor") => createRequisition(hr, { title, categoryId: t.guardId, headcount: 2, employmentType: "PERMANENT", justification: JUSTIFICATION, budgetedMonthlyGross: 987654 } as never);
  const rows = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, action } });
  return { t, hr, boss, raise, rows };
}

describe("the audit log and a requisition's private words", () => {
  it("raising one is recorded by its number, title, role and headcount, never the justification or the budget", async () => {
    const w = await setup();
    const r = await w.raise();
    const rows = await w.rows("REQUISITION_RAISE");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "JobRequisition", entityId: r.id });
    expect(rows[0].newValue).toMatchObject({ requisitionNumber: r.requisitionNumber, title: "Site Supervisor", categoryId: w.t.guardId, headcount: 2, employmentType: "PERMANENT" });
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/PRIVATE-JUSTIFICATION|leaver|987654/);
  });

  it("approving one is recorded as approved with its number, never the justification, the decision note or the budget", async () => {
    const w = await setup();
    const r = await w.raise();
    await approveRequisition(w.boss, r.id, "PRIVATE-DECISION-NOTE approved because the manager is leaving");
    const rows = await w.rows("REQUISITION_APPROVE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ requisitionNumber: r.requisitionNumber, status: "APPROVED" });
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE-JUSTIFICATION|PRIVATE-DECISION-NOTE|leaver|987654/);
  });

  it("rejecting one is recorded as rejected with its number and the approver's stated reason, never the justification or the budget", async () => {
    const w = await setup();
    const r = await w.raise();
    await rejectRequisition(w.boss, r.id, "No budget this year");
    const rows = await w.rows("REQUISITION_REJECT");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ requisitionNumber: r.requisitionNumber, status: "REJECTED" });
    expect(rows[0].reason).toBe("No budget this year"); // the decision's reason is the audit log's own reason field, as for every other decision
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE-JUSTIFICATION|leaver|987654/);
  });

  it("the requisition itself still holds the words, for the people who may read it", async () => {
    const w = await setup();
    const r = await w.raise();
    await approveRequisition(w.boss, r.id, "PRIVATE-DECISION-NOTE approved");
    const stored = await db.jobRequisition.findUniqueOrThrow({ where: { id: r.id } });
    expect(stored.justification).toBe(JUSTIFICATION);
    expect(stored.decisionNote).toBe("PRIVATE-DECISION-NOTE approved");
    expect(Number(stored.budgetedMonthlyGross)).toBe(987654);
  });
});
