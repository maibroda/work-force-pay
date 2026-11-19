import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { approveExit, initiateExit } from "@/server/services/hr";
import { addManualLine, cancelSettlement, prepareSettlement, removeManualLine, returnSettlement, submitSettlement } from "@/server/services/settlements";
import { isolatedOrg } from "../helpers";

// Follow-up to #219 to #227 (the founder chose "go ahead with the settlement entries" on 2026-11-18): the audit log carries a settlement line's id, kind, code and amount, and a settlement's number and
// status, never the line's description or the reason a settlement was sent back or cancelled. Those are finance and HR records; the audit log, which the administrators and the auditor read, must not show the
// same words. It is append-only and cannot be reached when a person is erased. The records themselves still hold everything. Amounts stay: the log is the money trail for a settlement.

const SECRETS = ["SECRET-LINE", "SECRET-RETURN", "SECRET-CANCEL"];
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const emp = await createEmployee(hr, { firstName: "Settle", lastName: "Audit", employmentDate: "2020-07-01", categoryId: t.officeId } as never);
  await db.employeePayRate.create({
    data: { organizationId: t.org.id, employeeId: emp.id, monthlyGross: 300000, reason: "Test", approvedBy: "Test", effectiveFrom: d("2026-01-01") },
  });
  const exit = await initiateExit(hr, { employeeId: emp.id, exitType: "RESIGNATION", noticeDate: "2027-03-21", lastWorkingDate: "2027-03-31", reason: "Better offer elsewhere", reasonCategory: "BETTER_PAY" });
  await approveExit(hr, exit.id);
  const prep = t.ctx("PAYROLL_ADMIN");
  const fin = t.ctx("FINANCE");
  const s = await prepareSettlement(prep, exit.id);
  const line = () => addManualLine(prep, s.id, { kind: "EARNING", code: "EX_GRATIA", description: "SECRET-LINE long-service goodwill for the Lekki post", amount: 20000, taxable: false });
  const log = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, action } });
  const noWords = (rows: unknown) => {
    const text = JSON.stringify(rows);
    for (const x of SECRETS) expect(text, x).not.toContain(x);
    expect(text).not.toMatch(/goodwill|Lekki|sent back|too high|no longer needed/i);
  };
  return { t, prep, fin, s, line, log, noWords };
}

describe("the audit log and a settlement's words", () => {
  it("adding a manual line is recorded by its id, kind, code and amount, never the description", async () => {
    const w = await world();
    const line = await w.line();
    const rows = await w.log("SETTLEMENT_LINE_ADD");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "ExitSettlement", entityId: w.s.id });
    expect(rows[0].newValue).toMatchObject({ lineId: line.id, kind: "EARNING", code: "EX_GRATIA", amount: 20000, taxable: false, manual: true });
    w.noWords(rows);
  });

  it("removing a manual line is recorded the same way, never the description", async () => {
    const w = await world();
    const line = await w.line();
    await removeManualLine(w.prep, line.id);
    const rows = await w.log("SETTLEMENT_LINE_REMOVE");
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ lineId: line.id, kind: "EARNING", code: "EX_GRATIA", amount: 20000 });
    w.noWords(rows);
  });

  it("sending a settlement back is recorded by its number and status, never the reason", async () => {
    const w = await world();
    await w.line();
    await submitSettlement(w.prep, w.s.id);
    await returnSettlement(w.fin, w.s.id, "SECRET-RETURN the goodwill amount is too high");
    const rows = await w.log("SETTLEMENT_RETURN");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ number: w.s.settlementNumber, status: "DRAFT" });
    expect(rows[0].reason).toBeNull();
    w.noWords(rows);
  });

  it("cancelling a settlement is recorded by its number and status, never the reason", async () => {
    const w = await world();
    await cancelSettlement(w.prep, w.s.id, "SECRET-CANCEL no longer needed, the exit was reversed");
    const rows = await w.log("SETTLEMENT_CANCEL");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ number: w.s.settlementNumber, status: "CANCELLED" });
    expect(rows[0].reason).toBeNull();
    w.noWords(rows);
  });

  it("the records themselves still hold the line's description and the reasons, for those with settlement access", async () => {
    const w = await world();
    const line = await w.line();
    expect((await db.exitSettlementLine.findUniqueOrThrow({ where: { id: line.id } })).description).toContain("SECRET-LINE");
    await submitSettlement(w.prep, w.s.id);
    await returnSettlement(w.fin, w.s.id, "SECRET-RETURN the goodwill amount is too high");
    expect((await db.exitSettlement.findUniqueOrThrow({ where: { id: w.s.id } })).remarks).toContain("SECRET-RETURN");
    await cancelSettlement(w.prep, w.s.id, "SECRET-CANCEL no longer needed");
    expect((await db.exitSettlement.findUniqueOrThrow({ where: { id: w.s.id } })).remarks).toContain("SECRET-CANCEL");
  });
});
