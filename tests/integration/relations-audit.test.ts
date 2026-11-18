import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { closeCase, raiseCase, reopenCase, resolveCase } from "@/server/services/relations";
import { isolatedOrg } from "../helpers";

// Follow-up to #219 to #224 (the founder chose "go ahead with the case entries" on 2026-11-18): the audit log carries a case's number, type, status and outcome, never its summary, its description, its
// resolution or a reason. Harassment, whistleblowing and welfare cases are confidential, and reads of them are recorded by record number; the audit log, which the administrators and the auditor read,
// must not show the same words. It is append-only and cannot be reached when a person is erased. The case itself still holds everything, for the people who may read it.

const SECRETS = ["SECRET-SUMMARY", "SECRET-DESCRIPTION", "SECRET-RESOLUTION", "SECRET-REOPEN"];
const outcome = { outcome: "SUBSTANTIATED", resolution: "SECRET-RESOLUTION the manager had shouted at the employee in front of the team" } as never;

async function world() {
  const t = await isolatedOrg();
  const hr1 = t.ctx("HR_ADMIN", null, 1);
  const hr2 = t.ctx("HR_ADMIN", null, 2);
  const emp = await createEmployee(hr1, { firstName: "Gbenga", lastName: "Case", employmentDate: "2023-01-05", categoryId: t.guardId } as never);
  const base = { employeeId: emp.id, summary: "SECRET-SUMMARY treatment by a manager", description: "SECRET-DESCRIPTION he shouts at me every day and has threatened me" };
  const grievance = () => raiseCase(hr1, { ...base, type: "GRIEVANCE" } as never);
  const harassment = () => raiseCase(hr1, { ...base, type: "HARASSMENT" } as never);
  const welfare = () => raiseCase(hr1, { ...base, type: "WELFARE", welfareKind: "BEREAVEMENT" } as never);
  const log = (caseId: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, entity: "RelationsCase", entityId: caseId }, orderBy: { createdAt: "asc" } });
  return { t, hr1, hr2, emp, grievance, harassment, welfare, log };
}

describe("the audit log and an Employee relations case's words", () => {
  it("resolving a case is recorded by its number, type, status and outcome, never the summary, description or resolution", async () => {
    const w = await world();
    const c = await w.grievance();
    await resolveCase(w.hr1, c.id, outcome);
    const row = (await w.log(c.id)).find((r) => r.action === "RELATIONS_CASE_RESOLVE")!;
    expect(row.newValue).toMatchObject({ caseNumber: c.caseNumber, type: "GRIEVANCE", status: "RESOLVED", outcome: "SUBSTANTIATED" });
    const text = JSON.stringify(row);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(text).not.toMatch(/shouted|shouts|threatened/);
  });

  it("closing a case is recorded by its number, status and the single-holder flag, never the words or the reason", async () => {
    const w = await world();
    const c = await w.grievance();
    await resolveCase(w.hr1, c.id, outcome);
    await closeCase(w.hr2, c.id);
    const row = (await w.log(c.id)).find((r) => r.action === "RELATIONS_CASE_CLOSE")!;
    expect(row.newValue).toMatchObject({ caseNumber: c.caseNumber, status: "CLOSED", outcome: "SUBSTANTIATED", closedSingleHolder: false });
    const text = JSON.stringify(row);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
  });

  it("reopening a case is recorded as a change of status, without the reason", async () => {
    const w = await world();
    const c = await w.grievance();
    await resolveCase(w.hr1, c.id, outcome);
    await closeCase(w.hr2, c.id);
    await reopenCase(w.hr2, c.id, "SECRET-REOPEN new evidence has come to light about the threats");
    const row = (await w.log(c.id)).find((r) => r.action === "RELATIONS_CASE_REOPEN")!;
    expect(row.reason).toBeNull();
    expect(row.newValue).toMatchObject({ caseNumber: c.caseNumber, type: "GRIEVANCE", status: "INVESTIGATING" });
    const text = JSON.stringify(row);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
  });

  it("a confidential harassment case and a welfare case are recorded the same way, at every step of their life", async () => {
    const w = await world();
    for (const make of [w.harassment, w.welfare]) {
      const c = await make();
      await resolveCase(w.hr1, c.id, outcome);
      await closeCase(w.hr2, c.id);
      await reopenCase(w.hr2, c.id, "SECRET-REOPEN new evidence has come to light");
      const rows = await w.log(c.id);
      expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["RELATIONS_CASE_RAISE", "RELATIONS_CASE_RESOLVE", "RELATIONS_CASE_CLOSE", "RELATIONS_CASE_REOPEN"]));
      const text = JSON.stringify(rows);
      for (const s of SECRETS) expect(text, `${c.type} ${s}`).not.toContain(s);
      expect(text).toContain(c.caseNumber);
    }
  });

  it("the case itself still holds the summary, the description, the resolution and the notes, for the people who may read them", async () => {
    const w = await world();
    const c = await w.grievance();
    await resolveCase(w.hr1, c.id, outcome);
    await closeCase(w.hr2, c.id);
    await reopenCase(w.hr2, c.id, "SECRET-REOPEN new evidence has come to light");
    const stored = await db.relationsCase.findUniqueOrThrow({ where: { id: c.id }, include: { notes: true } });
    expect(stored.summary).toContain("SECRET-SUMMARY");
    expect(stored.description).toContain("SECRET-DESCRIPTION");
    expect(JSON.stringify(stored.notes)).toContain("SECRET-REOPEN");
    expect(JSON.stringify(stored.notes)).toContain("SECRET-RESOLUTION");
  });
});
