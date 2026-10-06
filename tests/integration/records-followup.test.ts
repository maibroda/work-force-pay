import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { iso } from "@/lib/dates";
import { isolatedOrg } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { approveExit, initiateExit } from "@/server/services/hr";
import { createItem, issueKit, returnKit } from "@/server/services/inventory";
import { approveLoan, requestLoan, writeOffLoan } from "@/server/services/loans";
import { prepareSettlement } from "@/server/services/settlements";
import { buildHrDigest } from "@/server/services/reminders";
import { addContact, addGuarantor, listGuarantors, rejectGuarantor, releaseGuarantorsOnExit, verifyGuarantor } from "@/server/services/personal-records";

type Org = Awaited<ReturnType<typeof isolatedOrg>>;
let n = 0;
const guarantor = () => {
  n += 1;
  return { fullName: `Follow ${n}`, relationship: "Friend", phone: `0805000${String(n).padStart(4, "0")}`, address: "3 Marina Road, Lagos", idType: "NIN" as const, idNumber: `FNIN${2000 + n}`, formReference: `FGF-${n}` };
};

async function worker(t: Org, first: string, employmentDate = "2025-01-01") {
  return createEmployee(t.ctx("HR_ADMIN"), { firstName: first, lastName: "Followup", employmentDate, categoryId: t.guardId });
}

describe("releasing a leaver's guarantors", () => {
  it("waits until employment has ended and nothing is owed, then releases the live ones", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const ops = t.ctx("OPERATIONS");
    const emp = await worker(t, "Leaving");
    await db.employeePayRate.create({ data: { organizationId: t.org.id, employeeId: emp.id, monthlyGross: 100000, reason: "Test", approvedBy: "Test", effectiveFrom: new Date("2025-01-01T00:00:00Z") } });
    const verified = await addGuarantor(hr, emp.id, guarantor());
    await verifyGuarantor(hr, verified.id, "Visited");
    const pending = await addGuarantor(hr, emp.id, guarantor());
    const rejected = await addGuarantor(hr, emp.id, guarantor());
    await rejectGuarantor(hr, rejected.id, "Unreachable");

    // owes a loan and holds kit
    const shirt = await createItem(ops, { name: "Shirt", category: "UNIFORM", size: "L", unit: "pcs", reorderLevel: 0, openingQuantity: 5, openingUnitCost: 1000 });
    await issueKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 2 });
    const loan = await requestLoan(hr, { employeeId: emp.id, type: "LOAN", principal: 50000, installmentCount: 5, reason: "Rent" });
    await approveLoan(t.ctx("FINANCE"), loan.id, "Fine");

    await expect(releaseGuarantorsOnExit(hr, emp.id, "Cleared")).rejects.toThrow(/hasn't left/);
    await db.employee.update({ where: { id: emp.id }, data: { status: "RESIGNED" } });
    await expect(releaseGuarantorsOnExit(hr, emp.id, "")).rejects.toThrow(/reason/);
    await expect(releaseGuarantorsOnExit(t.ctx("PAYROLL_ADMIN"), emp.id, "Cleared")).rejects.toThrow();
    await expect(releaseGuarantorsOnExit(hr, emp.id, "Cleared")).rejects.toThrow(/staff loan balance \(LN-\d+\) and 2 item\(s\) of kit/);

    await returnKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 2, condition: "GOOD" });
    await expect(releaseGuarantorsOnExit(hr, emp.id, "Cleared")).rejects.toThrow(/staff loan balance/);
    await writeOffLoan(t.ctx("FINANCE"), loan.id, "Written off after exit");

    expect(await releaseGuarantorsOnExit(hr, emp.id, "Cleared, nothing owed")).toBe(2);
    const after = await listGuarantors(hr, { employeeId: emp.id });
    expect(Object.fromEntries(after.map((g) => [g.id, g.status]))).toEqual({ [verified.id]: "RELEASED", [pending.id]: "RELEASED", [rejected.id]: "REJECTED" });
    expect(after.find((g) => g.id === verified.id)!.releaseReason).toBe("Cleared, nothing owed");
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "GUARANTOR_RELEASE_ON_EXIT" } })).toBe(1);
    await expect(releaseGuarantorsOnExit(hr, emp.id, "Again")).rejects.toThrow(/no active guarantors/);
  });

  it("holds back while the settlement shows they owe more than they're due, and stays in its own organization", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const emp = await worker(t, "Owing");
    await db.employeePayRate.create({ data: { organizationId: t.org.id, employeeId: emp.id, monthlyGross: 100000, reason: "Test", approvedBy: "Test", effectiveFrom: new Date("2025-01-01T00:00:00Z") } });
    await addGuarantor(hr, emp.id, guarantor());
    const day = iso(todayUtc());
    const exit = await initiateExit(hr, { employeeId: emp.id, exitType: "RESIGNATION", noticeDate: day, lastWorkingDate: day, reason: "Moving away" });
    await approveExit(hr, exit.id);
    const st = await prepareSettlement(t.ctx("PAYROLL_ADMIN"), exit.id, { monthlyGrossOverride: 100000 });
    await db.exitSettlement.update({ where: { id: st.id }, data: { netSettlement: -25000 } });

    await expect(releaseGuarantorsOnExit(hr, emp.id, "Cleared")).rejects.toThrow(new RegExp(`more than they're due on settlement ${st.settlementNumber}`));
    const other = await isolatedOrg();
    await expect(releaseGuarantorsOnExit(other.ctx("HR_ADMIN"), emp.id, "Cleared")).rejects.toThrow(/not found/);

    await db.exitSettlement.update({ where: { id: st.id }, data: { netSettlement: 5000 } });
    expect(await releaseGuarantorsOnExit(hr, emp.id, "Settled in full")).toBe(1);
  });
});

describe("HR digest: personal records", () => {
  it("lists guarantors awaiting verification and who is short of records, but gives new joiners a month", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const old = await worker(t, "Veteran");
    await worker(t, "Newcomer", iso(todayUtc())); // joined today: not chased yet

    let d = await buildHrDigest(t.org.id);
    const records = d.sections.find((s) => s.key === "records")!;
    expect(records.count).toBe(1); // only the veteran
    expect(records.items.map((i) => i.text)).toEqual(["1 employee(s) have no next of kin on file", "1 employee(s) have no emergency contact", "1 employee(s) are short of verified guarantors"]);
    expect(d.sections.find((s) => s.key === "guarantors")).toBeUndefined();

    const g1 = await addGuarantor(hr, old.id, guarantor());
    d = await buildHrDigest(t.org.id);
    const waiting = d.sections.find((s) => s.key === "guarantors")!;
    expect(waiting.items[0].text).toMatch(/Follow \d+ for EMP-\d+ Veteran Followup — recorded/);
    expect(waiting.items[0].path).toBe(`/employees/${old.id}?tab=contacts`);

    // once complete, both of this feature's sections go quiet (the digest's other sections are unrelated)
    await verifyGuarantor(hr, g1.id, "Visited");
    await verifyGuarantor(hr, (await addGuarantor(hr, old.id, guarantor())).id, "Visited");
    await addContact(hr, old.id, { kind: "NEXT_OF_KIN", fullName: "Next Kin", relationship: "Spouse", phone: "08026660001" });
    await addContact(hr, old.id, { kind: "EMERGENCY_CONTACT", fullName: "Em Contact", relationship: "Sibling", phone: "08026660002" });
    d = await buildHrDigest(t.org.id);
    const keys = d.sections.map((s) => s.key);
    expect(keys).not.toContain("records");
    expect(keys).not.toContain("guarantors");
    expect(d.total).toBe(d.sections.reduce((s, x) => s + x.count, 0));
  });
});
