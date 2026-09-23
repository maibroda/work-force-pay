import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { d, eachDay, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import {
  addContractRate,
  createBeat,
  createClient,
  createContract,
  setContractBusinessLine,
} from "@/server/services/clients";
import { createStructure } from "@/server/services/structures";
import { createEmployee } from "@/server/services/employees";
import { deployEmployee, recordAttendance, recordMonthlyAttendance } from "@/server/services/operations";
import { generateRemittances, listRemittances } from "@/server/services/payments";
import { approveRun, createPeriod, lockRun, runPayroll, submitForApproval } from "@/server/services/payroll";
import { clientProfitability } from "@/server/services/reports";
import { beatByName, ctxFor, uid } from "../helpers";

describe("business lines: guarding vs outsourcing vs back-office", () => {
  it("a contract's business line can be reclassified, and only by someone who can manage clients", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const auditor = await ctxFor("AUDITOR");
    const contract = await db.contract.findFirstOrThrow({ where: { organizationId: admin.orgId } });
    expect(contract.businessLine).toBe("GUARDING"); // seeded default
    await expect(setContractBusinessLine(auditor, contract.id, "OUTSOURCING")).rejects.toThrow();
    const updated = await setContractBusinessLine(admin, contract.id, "OUTSOURCING");
    expect(updated.businessLine).toBe("OUTSOURCING");
    await setContractBusinessLine(admin, contract.id, "GUARDING"); // restore for other tests
    expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).businessLine).toBe(
      "GUARDING",
    );
  });

  it("an OUTSOURCING contract gets a leave allowance (20% of Basic) but no uniform & kits — the reverse of GUARDING", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const hr = await ctxFor("HR_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const fin = await ctxFor("FINANCE");
    const tag = uid();

    const client = await createClient(admin, { name: `Outsourcing Client ${tag}` });
    const structure = await createStructure(payroll, {
      code: `OUT-${tag}`,
      name: `Outsourcing Structure ${tag}`,
      effectiveFrom: "2027-01-01",
      activate: true,
      components: DEFAULT_EARNINGS.map((c, i) => ({
        code: c.code,
        name: c.name,
        calcType: "PERCENTAGE" as const,
        percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i],
        taxable: true,
        pensionable: c.pensionable,
      })),
    });
    const contract = await createContract(admin, {
      clientId: client.id,
      name: "Outsourced Cleaning Staff 2027",
      startDate: "2027-01-01",
      defaultStructureId: structure.id,
      operativeSharePct: 70,
      businessLine: "OUTSOURCING",
    });
    expect(contract.businessLine).toBe("OUTSOURCING");
    const cat = await db.employeeCategory.findFirstOrThrow({
      where: { organizationId: admin.orgId, code: "GUARD" },
    });
    await addContractRate(admin, {
      contractId: contract.id,
      categoryId: cat.id,
      salaryStructureId: structure.id,
      agreedRate: 120000,
      effectiveFrom: "2027-01-01",
    });
    const beat = await createBeat(admin, {
      contractId: contract.id,
      name: `Outsourcing Site ${tag}`,
      approvedStrength: 1,
    });
    const emp = await createEmployee(hr, {
      firstName: "Outsourced",
      lastName: `Staff${tag}`,
      employmentDate: "2027-01-01",
      categoryId: cat.id,
      bankName: "GTBank",
      accountNumber: `70${String(Date.now()).slice(-8)}`,
      accountName: `OUTSOURCED STAFF ${tag}`,
    });
    await deployEmployee(ops, { employeeId: emp.id, beatId: beat.id, startDate: "2027-03-01" });
    await recordAttendance(
      ops,
      eachDay(d("2027-03-01"), d("2027-03-31")).map((dt) => ({
        employeeId: emp.id,
        beatId: beat.id,
        date: iso(dt),
        status: "PRESENT" as const,
      })),
    );

    const period = await createPeriod(payroll, 2027, 3);
    const run = await runPayroll(payroll, period.id);
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: emp.id } });
    expect(rec.businessLine).toBe("OUTSOURCING");
    expect(num(rec.uniformKitsAmount)).toBe(0);
    expect(num(rec.outsourcingLeaveAllowanceAmount)).toBeGreaterThan(0);
    const basic = (rec.lines as Array<{ code: string; amount: number }>).find(
      (l) => l.code === "BASIC",
    )!.amount;
    expect(num(rec.outsourcingLeaveAllowanceAmount)).toBeCloseTo(basic * 0.2, 2);
    expect(num(rec.itfAmount)).toBeGreaterThan(0);
    expect(num(rec.nsitfAmount)).toBeGreaterThan(0);
    expect(num(rec.insuranceAmount)).toBeGreaterThan(0);
    expect(num(rec.employerCost)).toBeCloseTo(
      num(rec.totalEarnings) + num(rec.employerPension) + num(rec.totalEmployerAddOns),
      2,
    );

    const criticals = await db.payrollValidationIssue.count({
      where: { runId: run.id, severity: "CRITICAL", overridden: false },
    });
    expect(criticals).toBe(0);
    await submitForApproval(payroll, run.id);
    await approveRun(fin, run.id);
    await lockRun(fin, run.id);

    // locking posts to the GL — the leave-allowance head has its own account, uniform & kits is absent
    const journal = await db.journalEntry.findUniqueOrThrow({
      where: { runId: run.id },
      include: { lines: true },
    });
    const leaveLine = journal.lines.find((l) => l.headCode === "OUTSOURCING_LEAVE_ALLOWANCE");
    expect(leaveLine?.accountCode).toBe("5360");
    expect(journal.lines.find((l) => l.headCode === "UNIFORM_KITS")).toBeUndefined();

    const profit = await clientProfitability(payroll, run.id);
    const p = profit.find((x) => x.clientName === client.name)!;
    expect(p.otherCosts).toBeCloseTo(num(rec.totalEmployerAddOns), 2);

    // each employer add-on cost type gets its own remittance schedule (employer-only — no employee share)
    await generateRemittances(fin, run.id);
    const remittances = await listRemittances(fin, { runId: run.id });
    const byType = new Map(remittances.map((r) => [r.type, r]));
    expect(num(byType.get("ITF")?.employerAmount)).toBeCloseTo(num(rec.itfAmount), 2);
    expect(num(byType.get("NSITF")?.employerAmount)).toBeCloseTo(num(rec.nsitfAmount), 2);
    expect(num(byType.get("INSURANCE")?.employerAmount)).toBeCloseTo(num(rec.insuranceAmount), 2);
    expect(num(byType.get("OUTSOURCING_LEAVE_ALLOWANCE")?.employerAmount)).toBeCloseTo(
      num(rec.outsourcingLeaveAllowanceAmount),
      2,
    );
    expect(byType.get("UNIFORM_KITS")).toBeUndefined(); // OUTSOURCING never has uniform & kits
    for (const type of ["ITF", "NSITF", "INSURANCE", "OUTSOURCING_LEAVE_ALLOWANCE"] as const)
      expect(num(byType.get(type)?.employeeAmount)).toBe(0); // employer-only costs
  });

  it("back-office (pay-rate, no contract) staff carry zero employer add-on costs", async () => {
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const julyRun = await db.payrollRun.findFirstOrThrow({
      where: { organizationId: payroll.orgId, type: "REGULAR", status: { in: ["LOCKED", "PAID"] } },
      orderBy: [{ period: { year: "asc" } }, { period: { month: "asc" } }],
    });
    const office = await db.payrollRecord.findMany({
      where: { runId: julyRun.id, categoryName: "Office Staff" },
    });
    expect(office.length).toBeGreaterThan(0);
    for (const r of office) {
      expect(r.businessLine).toBe("BACK_OFFICE");
      expect(num(r.totalEmployerAddOns)).toBe(0);
      expect(num(r.itfAmount)).toBe(0);
      expect(num(r.uniformKitsAmount)).toBe(0);
      expect(num(r.outsourcingLeaveAllowanceAmount)).toBe(0);
    }
  });
});

describe("monthly attendance quick entry", () => {
  it("days in month is fixed, days worked defaults to it and is adjustable — the shortfall is marked absent", async () => {
    const ops = await ctxFor("OPERATIONS");
    const vi = await beatByName(ops, "Victoria Island Branch");
    const dep = await db.deployment.findFirstOrThrow({
      where: {
        organizationId: ops.orgId,
        beatId: vi.id,
        status: "ACTIVE",
        employee: { status: "ACTIVE" },
      },
      include: { employee: true },
    });
    const emp = dep.employee;
    const range = { gte: d("2027-02-01"), lte: d("2027-02-28") };
    expect(await db.workRegister.count({ where: { employeeId: emp.id, beatId: vi.id, date: range } })).toBe(
      0,
    );

    const r = await recordMonthlyAttendance(ops, {
      beatId: vi.id,
      year: 2027,
      month: 2,
      rows: [{ employeeId: emp.id, daysWorked: 17 }],
    });
    expect(r.summary).toEqual([
      {
        employeeId: emp.id,
        employeeNumber: emp.employeeNumber,
        daysInMonth: 28,
        daysWorked: 17,
        daysAbsent: 11,
      },
    ]);
    const rows = await db.workRegister.findMany({
      where: { employeeId: emp.id, beatId: vi.id, date: range },
      orderBy: { date: "asc" },
    });
    expect(rows).toHaveLength(28); // February 2027 has 28 days
    expect(rows.slice(0, 17).every((x) => x.attendanceStatus === "PRESENT")).toBe(true);
    expect(rows.slice(17).every((x) => x.attendanceStatus === "ABSENT")).toBe(true);

    // adjusting back up to the full month re-marks every day present
    const r2 = await recordMonthlyAttendance(ops, {
      beatId: vi.id,
      year: 2027,
      month: 2,
      rows: [{ employeeId: emp.id, daysWorked: 28 }],
    });
    expect(r2.summary[0]).toMatchObject({ daysWorked: 28, daysAbsent: 0 });
    expect(
      (await db.workRegister.findMany({ where: { employeeId: emp.id, beatId: vi.id, date: range } })).every(
        (x) => x.attendanceStatus === "PRESENT",
      ),
    ).toBe(true);

    // a value beyond the days in the month is clamped, not rejected
    const r3 = await recordMonthlyAttendance(ops, {
      beatId: vi.id,
      year: 2027,
      month: 2,
      rows: [{ employeeId: emp.id, daysWorked: 999 }],
    });
    expect(r3.summary[0].daysWorked).toBe(28);

    // a supervisor may only do this for beats they supervise
    const sup = await ctxFor("SUPERVISOR");
    const ota = await beatByName(ops, "Ota Warehouse"); // seeded with no supervisor
    await expect(
      recordMonthlyAttendance(sup, {
        beatId: ota.id,
        year: 2027,
        month: 2,
        rows: [{ employeeId: emp.id, daysWorked: 10 }],
      }),
    ).rejects.toThrow(/not the supervisor/);
  });
});
