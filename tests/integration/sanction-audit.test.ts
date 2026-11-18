import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { approveDisciplinary, raiseDisciplinary, rejectDisciplinary } from "@/server/services/hr";
import { raiseCase } from "@/server/services/relations";
import { isolatedOrg } from "../helpers";

// Follow-up to #219 to #225 (the founder chose "go ahead with the sanction entries" on 2026-11-18): the audit log carries a sanction's id, type, status and the incident day, never its description, the
// action taken, or anyone's remarks. Sanctions are disciplinary records, read only by those with disciplinary access and recorded by record number when read; the audit log, which the administrators
// and the auditor read, must not show the same words. It is append-only and cannot be reached when a person is erased. The record itself still holds everything.

const SECRETS = ["SECRET-DESCRIPTION", "SECRET-ACTION", "SECRET-REMARKS", "SECRET-REJECT", "SECRET-PRAISE"];
const incidentDate = () => iso(addDays(todayUtc(), -3));

async function world() {
  const t = await isolatedOrg();
  const hr1 = t.ctx("HR_ADMIN", null, 1);
  const hr2 = t.ctx("HR_ADMIN", null, 2);
  const emp = await createEmployee(hr1, { firstName: "Gbenga", lastName: "Sanction", employmentDate: "2023-01-05", categoryId: t.guardId } as never);
  const raise = (over: Record<string, unknown> = {}) =>
    raiseDisciplinary(hr1, { employeeId: emp.id, type: "WRITTEN_WARNING", incidentDate: incidentDate(), description: "SECRET-DESCRIPTION left the post and a client complained", actionTaken: "SECRET-ACTION a written warning on file", ...over } as never);
  const log = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, action } });
  return { t, hr1, hr2, emp, raise, log };
}

describe("the audit log and a disciplinary sanction's words", () => {
  it("raising a sanction is recorded by its id, type, status and incident day, never the description or the action taken", async () => {
    const w = await world();
    const rec = await w.raise();
    const rows = await w.log("DISCIPLINARY_RECORD_RAISE");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "Employee", entityId: w.emp.id });
    expect(rows[0].newValue).toMatchObject({ recordId: rec.id, type: "WRITTEN_WARNING", status: "PENDING", incidentDate: incidentDate() });
    const text = JSON.stringify(rows);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(text).not.toMatch(/left the post|client complained|written warning on file/);
  });

  it("a sanction raised from a case carries the case's id, never its words", async () => {
    const w = await world();
    const c = await raiseCase(w.hr1, { employeeId: w.emp.id, type: "MISCONDUCT", summary: "A misconduct case", description: "Details of the case." } as never);
    await w.raise({ caseId: c.id });
    const row = (await w.log("DISCIPLINARY_RECORD_RAISE"))[0];
    expect(row.newValue).toMatchObject({ caseId: c.id });
  });

  it("approving a sanction is recorded as approved with the single-holder flag, never the remarks, the description or the action taken", async () => {
    const w = await world();
    const rec = await w.raise();
    await approveDisciplinary(w.hr2, rec.id, "SECRET-REMARKS signed off after reading the statement");
    const rows = await w.log("DISCIPLINARY_RECORD_APPROVE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ recordId: rec.id, type: "WRITTEN_WARNING", status: "APPROVED", approvedSingleHolder: false });
    const text = JSON.stringify(rows);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
  });

  it("rejecting a sanction is recorded as rejected, never the remarks, the description or the action taken", async () => {
    const w = await world();
    const rec = await w.raise();
    await rejectDisciplinary(w.hr2, rec.id, "SECRET-REJECT the evidence does not support it");
    const rows = await w.log("DISCIPLINARY_RECORD_REJECT");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ recordId: rec.id, status: "REJECTED" });
    const text = JSON.stringify(rows);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
  });

  it("a commendation is recorded the same way: its type and status, never the praise", async () => {
    const w = await world();
    const rec = await w.raise({ type: "COMMENDATION", description: "SECRET-PRAISE stayed at the post through the flood and protected the client's stock", actionTaken: undefined });
    await approveDisciplinary(w.hr2, rec.id);
    const rows = [...(await w.log("DISCIPLINARY_RECORD_RAISE")), ...(await w.log("DISCIPLINARY_RECORD_APPROVE"))];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r.newValue as { type: string }).type)).toEqual(["COMMENDATION", "COMMENDATION"]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-PRAISE|flood|stock/);
  });

  it("the record itself still holds the description, the action taken and the remarks, for those with disciplinary access", async () => {
    const w = await world();
    const rec = await w.raise();
    await approveDisciplinary(w.hr2, rec.id, "SECRET-REMARKS signed off after reading the statement");
    const stored = await db.disciplinaryRecord.findUniqueOrThrow({ where: { id: rec.id } });
    expect(stored.description).toContain("SECRET-DESCRIPTION");
    expect(stored.actionTaken).toContain("SECRET-ACTION");
    expect(stored.remarks).toContain("SECRET-REMARKS");
  });
});
