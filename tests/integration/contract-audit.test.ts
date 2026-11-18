import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { createContract, decideProbation, renewContract } from "@/server/services/contracts";
import { isolatedOrg } from "../helpers";

// Follow-up to #219 to #221 (the founder chose this on 2026-11-17): the audit log carries ids, numbers, the decision and the dates, never a decider's free-text reason or a contract's notes. The audit
// log is read by the administrators and the auditor, is append-only, and cannot be reached when a person is erased. The probation decision and the contract themselves still hold everything
// (the decision's note, the contract's notes), for the people who may read them.

const SECRETS = ["SECRET-CONTRACT-NOTE", "SECRET-FAIL-REASON", "SECRET-EXTEND-REASON", "SECRET-CONFIRM-NOTE", "SECRET-RENEW-NOTE"];

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const boss = t.ctx("COMPANY_ADMIN");
  const person = (first: string) => createEmployee(hr, { firstName: first, lastName: "Probee", employmentDate: "2026-01-01", categoryId: t.guardId } as never);
  const probation = async (first: string) => {
    const e = await person(first);
    const c = await createContract(hr, { employeeId: e.id, type: "PROBATION", jobTitle: "Guard", startDate: "2026-01-01", probationMonths: 3, notes: "SECRET-CONTRACT-NOTE agreed a lower start date" } as never);
    return { e, c };
  };
  const audit = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, action } });
  return { t, hr, boss, person, probation, audit };
}

describe("the audit log and a contract's words", () => {
  it("making a contract is recorded by its number, type and dates, never its notes", async () => {
    const w = await world();
    const { c } = await w.probation("Created");
    const rows = await w.audit("EMPLOYMENT_CONTRACT_CREATE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ contractNumber: c.contractNumber, type: "PROBATION", probationMonths: 3 });
    expect(JSON.stringify(rows)).not.toContain("SECRET-CONTRACT-NOTE");
  });

  it("failing a probation is recorded as the decision on that contract, never the reason or the contract's notes", async () => {
    const w = await world();
    const { c, e } = await w.probation("Failed");
    await decideProbation(w.boss, c.id, { decision: "FAILED", note: "SECRET-FAIL-REASON targets were missed every week" });
    const rows = await w.audit("PROBATION_FAIL");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "Employee", entityId: e.id, reason: null });
    expect(rows[0].newValue).toMatchObject({ contractId: c.id, decision: "FAILED" });
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-FAIL-REASON|SECRET-CONTRACT-NOTE/);
  });

  it("extending a probation is recorded with the months and the new end date, never the reason or the notes", async () => {
    const w = await world();
    const { c } = await w.probation("Extended");
    await decideProbation(w.boss, c.id, { decision: "EXTENDED", note: "SECRET-EXTEND-REASON needs one more month", extensionMonths: 1 });
    const rows = await w.audit("PROBATION_EXTEND");
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBeNull();
    expect(rows[0].newValue).toMatchObject({ contractId: c.id, decision: "EXTENDED", extensionMonths: 1 });
    expect((rows[0].newValue as { probationEndDate?: string }).probationEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-EXTEND-REASON|SECRET-CONTRACT-NOTE/);
  });

  it("confirming a probation is recorded as the decision, with the permanent contract's number, never the note or the contract's notes", async () => {
    const w = await world();
    const { c } = await w.probation("Confirmed");
    const done = await decideProbation(w.boss, c.id, { decision: "CONFIRMED", note: "SECRET-CONFIRM-NOTE excellent record", effectiveDate: "2026-04-02" });
    const rows = await w.audit("PROBATION_CONFIRM");
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBeNull();
    expect(rows[0].newValue).toMatchObject({ contractId: c.id, decision: "CONFIRMED", permanentContract: done.next!.contractNumber });
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-CONFIRM-NOTE|SECRET-CONTRACT-NOTE/);
  });

  it("renewing a contract is recorded by the old and new contract's numbers, never either one's notes", async () => {
    const w = await world();
    const e = await w.person("Renewed");
    const first = await createContract(w.hr, { employeeId: e.id, type: "FIXED_TERM", jobTitle: "Guard", startDate: "2026-01-01", endDate: "2026-12-31", notes: "SECRET-CONTRACT-NOTE first contract" } as never);
    const next = await renewContract(w.hr, first.id, { endDate: "2027-12-31", notes: "SECRET-RENEW-NOTE second contract" });
    const rows = await w.audit("EMPLOYMENT_CONTRACT_RENEW");
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ contractNumber: first.contractNumber });
    expect(rows[0].newValue).toMatchObject({ contractNumber: next.contractNumber, type: "FIXED_TERM" });
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-CONTRACT-NOTE|SECRET-RENEW-NOTE/);
  });

  it("everything is still held on the records themselves, for the people who may read them", async () => {
    const w = await world();
    const { c, e } = await w.probation("Records");
    await decideProbation(w.boss, c.id, { decision: "FAILED", note: "SECRET-FAIL-REASON targets were missed every week" });
    const contract = await db.employmentContract.findUniqueOrThrow({ where: { id: c.id } });
    expect(contract.notes).toContain("SECRET-CONTRACT-NOTE");
    expect(contract.notes).toContain("SECRET-FAIL-REASON");
    const decision = await db.probationDecision.findFirstOrThrow({ where: { employeeId: e.id } });
    expect(decision.note).toContain("SECRET-FAIL-REASON");
    for (const s of SECRETS.slice(0, 2)) expect(JSON.stringify(contract), s).toContain(s);
  });
});
