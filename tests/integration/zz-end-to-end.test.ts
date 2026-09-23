/**
 * CRITICAL END-TO-END TEST (spec §47) — runs the whole WorkforcePay business process against the
 * seeded database through the same service layer the UI uses.
 */
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eachDay, iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { authenticate } from "@/server/services/users";
import {
  addContractRate,
  createBeat,
  createClient,
  createContract,
  listBeats,
  updateBeatStrength,
} from "@/server/services/clients";
import { createStructure } from "@/server/services/structures";
import { createEmployee } from "@/server/services/employees";
import {
  createMovement,
  deployEmployee,
  recordAttendance,
  resolveMismatch,
} from "@/server/services/operations";
import {
  approveArrears,
  approveDeduction,
  approveOvertime,
  createArrears,
  createDeduction,
  createOvertime,
} from "@/server/services/inputs";
import {
  approveRun,
  createPeriod,
  getPayslip,
  lockRun,
  overrideIssue,
  runPayroll,
  submitForApproval,
} from "@/server/services/payroll";
import {
  payeSchedule,
  payrollByClientAndBeat,
  payrollRegister,
  pensionSchedule,
  beatReconciliation,
  clientProfitability,
} from "@/server/services/reports";
import { listAudit } from "@/server/services/audit";
import { ctxFor, periodFor, uid } from "../helpers";

describe("CRITICAL END-TO-END: client → contract → structure → beats → employees → movement → work register → payroll → lock → payslip → reports → audit", () => {
  it("runs the complete WorkforcePay workflow", async () => {
    // LOGIN
    const user = await authenticate("admin@demosecurity.test", "Password123!");
    expect(user).toBeTruthy();
    expect(await authenticate("admin@demosecurity.test", "wrong-password")).toBeNull();
    const admin = await ctxFor("COMPANY_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const fin = await ctxFor("FINANCE");
    const tag = uid();

    // CREATE CLIENT → CONTRACT → SALARY STRUCTURE (separate from default)
    const client = await createClient(admin, { name: `E2E Bank ${tag}`, contactPerson: "Test Contact" });
    const structure = await createStructure(payroll, {
      code: `E2E-${tag}`,
      name: `E2E Bank Guard Structure ${tag}`,
      effectiveFrom: "2026-01-01",
      activate: true,
      components: DEFAULT_EARNINGS.map((c, i) => ({
        code: c.code,
        name: c.name,
        calcType: "PERCENTAGE" as const,
        percentage: [12, 15, 13, 5, 15, 20, 3, 5, 12][i],
        taxable: true,
        pensionable: c.pensionable,
      })),
    });
    const contract = await createContract(admin, {
      clientId: client.id,
      name: "Security Services 2026",
      startDate: "2026-01-01",
      defaultStructureId: structure.id,
      operativeSharePct: 70,
    });
    const guard = await db.employeeCategory.findFirstOrThrow({
      where: { organizationId: admin.orgId, code: "GUARD" },
    });
    await addContractRate(admin, {
      contractId: contract.id,
      categoryId: guard.id,
      salaryStructureId: structure.id,
      agreedRate: 120000,
      effectiveFrom: "2026-01-01",
    });

    // CREATE BEATS (locations) & SET APPROVED STRENGTH
    const names = ["Victoria Island", "Marina", "Ikoyi", "Lekki"];
    const beats: Awaited<ReturnType<typeof createBeat>>[] = [];
    for (const n of names)
      beats.push(
        await createBeat(admin, {
          contractId: contract.id,
          name: `${n} ${tag}`,
          bidReference: `BID-E2E-${tag}`,
          region: "Lagos",
          state: "Lagos",
          approvedStrength: 1,
        }),
      );
    await updateBeatStrength(admin, beats[0].id, 2, "Client requested one more guard");
    expect((await listBeats(admin, { clientId: client.id })).every((b) => b.status === "UNMAPPED")).toBe(
      true,
    );

    // CREATE EMPLOYEES → AUTOMATIC EMPLOYEE NUMBERS
    const hr = await ctxFor("HR_ADMIN");
    const bank = (n: number) => ({
      bankName: "GTBank",
      accountNumber: `70${tag.length}${String(1000000 + n).padStart(7, "0")}`.slice(0, 10),
      accountName: `E2E GUARD ${n}`,
    });
    const e1 = await createEmployee(hr, {
      firstName: "Multi",
      lastName: `Location${tag}`,
      employmentDate: "2026-01-15",
      categoryId: guard.id,
      taxId: `TIN-E2E-${tag}`,
      pensionPin: `PENE2E${tag}1`,
      pfa: "Stanbic IBTC Pension Managers",
      ...bank(1),
    });
    const e2 = await createEmployee(hr, {
      firstName: "Second",
      lastName: `Guard${tag}`,
      employmentDate: "2026-01-15",
      categoryId: guard.id,
      taxId: `TIN-E2E-${tag}2`,
      pensionPin: `PENE2E${tag}2`,
      pfa: "Leadway Pensure PFA",
      ...bank(2),
    });
    expect(e1.employeeNumber).toMatch(/^EMP-\d{6}$/);
    expect(Number(e2.employeeNumber.slice(4))).toBe(Number(e1.employeeNumber.slice(4)) + 1);

    // MAP EMPLOYEES TO BEATS
    await deployEmployee(ops, { employeeId: e1.id, beatId: beats[0].id, startDate: "2026-10-01" });
    await deployEmployee(ops, { employeeId: e2.id, beatId: beats[0].id, startDate: "2026-10-01" });

    // STAFF MOVEMENT — one employee across FOUR beats in October
    await createMovement(ops, {
      employeeId: e1.id,
      toBeatId: beats[1].id,
      movementType: "LOCATION_TRANSFER",
      movementDate: "2026-10-11",
      effectiveDate: "2026-10-11",
      reason: "Cover Marina",
      approve: true,
    });
    await createMovement(ops, {
      employeeId: e1.id,
      toBeatId: beats[2].id,
      movementType: "LOCATION_TRANSFER",
      movementDate: "2026-10-19",
      effectiveDate: "2026-10-19",
      reason: "Cover Ikoyi",
      approve: true,
    });
    await createMovement(ops, {
      employeeId: e1.id,
      toBeatId: beats[3].id,
      movementType: "LOCATION_TRANSFER",
      movementDate: "2026-10-26",
      effectiveDate: "2026-10-26",
      reason: "Cover Lekki",
      approve: true,
    });

    // WORK REGISTER — attendance per location (31 days in October)
    const plan: Array<[string, string, number]> = [
      ["2026-10-01", "2026-10-10", 0],
      ["2026-10-11", "2026-10-18", 1],
      ["2026-10-19", "2026-10-25", 2],
      ["2026-10-26", "2026-10-31", 3],
    ];
    const entries = plan.flatMap(([f, t, b]) =>
      eachDay(new Date(`${f}T00:00:00Z`), new Date(`${t}T00:00:00Z`)).map((dt) => ({
        employeeId: e1.id,
        beatId: beats[b].id,
        date: iso(dt),
        status: "PRESENT" as const,
      })),
    );
    const e2entries = eachDay(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T00:00:00Z")).map(
      (dt) => ({
        employeeId: e2.id,
        beatId: beats[0].id,
        date: iso(dt),
        status: iso(dt) === "2026-10-07" ? ("ABSENT" as const) : ("PRESENT" as const),
      }),
    );
    // one wrong-location entry to exercise the exception workflow
    e2entries[14] = { ...e2entries[14], beatId: beats[2].id };
    const res = await recordAttendance(ops, [...entries, ...e2entries]);
    expect(res.saved).toBe(62);
    expect(res.mismatches).toHaveLength(1);

    // CREATE PAYROLL PERIOD (October) → OVERTIME, ARREARS, APPROVED DEDUCTION
    const oct = await createPeriod(payroll, 2026, 10);
    const ot = await createOvertime(payroll, {
      employeeId: e1.id,
      beatId: beats[1].id,
      periodId: oct.id,
      date: "2026-10-12",
      hours: 6,
      approvalReference: `E2E/OT/${tag}`,
    });
    await approveOvertime(fin, ot.id);
    const aug = await periodFor(payroll, 2026, 8);
    const arr = await createArrears(payroll, {
      employeeId: e1.id,
      originalPeriodId: aug.id,
      arrearsType: "MISSED_PAYMENT",
      originalAmount: 0,
      correctedAmount: 10000,
      reason: "Missed August meal allowance",
    });
    await approveArrears(fin, arr.id);
    const ded = await createDeduction(payroll, {
      employeeId: e1.id,
      deductionType: "PENALTY",
      amount: 2000,
      periodId: oct.id,
      reason: "Late to post",
      authorityReference: `DISC/${tag}`,
    });
    await approveDeduction(fin, ded.id);

    // RUN PAYROLL → VALIDATE
    let run = await runPayroll(payroll, oct.id);
    let issues = await db.payrollValidationIssue.findMany({
      where: { runId: run.id, severity: "CRITICAL", overridden: false },
    });
    expect(issues.some((i) => i.code === "LOCATION_MISMATCH" && i.employeeId === e2.id)).toBe(true);

    // RESOLVE LOCATION EXCEPTION → recalculate
    const wr = await db.workRegister.findFirstOrThrow({
      where: { employeeId: e2.id, locationMismatch: true },
    });
    await resolveMismatch(ops, {
      workRegisterId: wr.id,
      action: "CORRECT_TO_ASSIGNED_BEAT",
      note: "Data entry error by supervisor",
    });
    run = await runPayroll(payroll, oct.id);
    issues = await db.payrollValidationIssue.findMany({
      where: { runId: run.id, severity: "CRITICAL", overridden: false },
    });
    expect(issues.filter((i) => i.employeeId === e1.id || i.employeeId === e2.id)).toHaveLength(0);
    for (const i of issues)
      await overrideIssue(fin, i.id, "Pre-existing seeded data exception reviewed by Finance");

    // PAYE, EMPLOYEE PENSION, EMPLOYER PENSION
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: e1.id } });
    const monthly = 84000; // 70% of ₦120,000
    expect(num(rec.monthlyGross)).toBe(monthly);
    expect(num(rec.earnedGross)).toBeCloseTo(monthly, 2); // 31 paid days of 31
    const pensionBase = round2(monthly * 0.4) + num(arr.pensionableImpact);
    expect(num(rec.pensionBase)).toBeCloseTo(pensionBase, 2);
    expect(num(rec.employeePension)).toBeCloseTo(pensionBase * 0.08, 1);
    expect(num(rec.employerPension)).toBeCloseTo(pensionBase * 0.1, 1);
    expect(num(rec.paye)).toBeGreaterThan(0);
    expect(num(rec.overtimeAmount)).toBeGreaterThan(0);
    expect(num(rec.arrearsAmount)).toBe(10000);
    expect(num(rec.otherDeductions)).toBe(2000);
    expect(num(rec.netPay)).toBeCloseTo(
      num(rec.totalEarnings) - num(rec.paye) - num(rec.employeePension) - 2000,
      2,
    );
    expect(num(rec.clientBilling)).toBeCloseTo(120000, 2);
    expect(num(rec.managementShare)).toBeCloseTo(36000, 2);

    // APPROVE → LOCK
    await submitForApproval(payroll, run.id);
    await approveRun(fin, run.id);
    await lockRun(fin, run.id);
    expect((await db.payrollPeriod.findUniqueOrThrow({ where: { id: oct.id } })).status).toBe("LOCKED");

    // GENERATE PAYSLIP → SHOW ALL LOCATIONS WORKED
    const slip = await getPayslip(payroll, rec.id);
    const locs = slip!.locations as Array<{ beatName: string; days: number }>;
    expect(locs.map((l) => [l.beatName.replace(` ${tag}`, ""), l.days])).toEqual([
      ["Victoria Island", 10],
      ["Marina", 8],
      ["Ikoyi", 7],
      ["Lekki", 6],
    ]);

    // PAYROLL REGISTER, PENSION REPORT, PAYE REPORT
    const register = await payrollRegister(payroll, run.id, { clientId: client.id });
    expect(register.map((r) => r.employeeNumber).sort()).toEqual(
      [e1.employeeNumber, e2.employeeNumber].sort(),
    );
    const pension = await pensionSchedule(payroll, run.id);
    expect(pension.find((p) => p.employeeNumber === e1.employeeNumber)!.employerPension).toBeCloseTo(
      num(rec.employerPension),
      2,
    );
    const paye = await payeSchedule(payroll, run.id);
    expect(paye.find((p) => p.employeeNumber === e1.employeeNumber)!.paye).toBe(num(rec.paye));

    // CLIENT / BEAT COST
    const byClient = await payrollByClientAndBeat(payroll, run.id, client.id);
    expect(byClient).toHaveLength(1);
    expect(byClient[0].beats).toHaveLength(4);
    expect(byClient[0].headcount).toBe(2);
    const recon = await beatReconciliation(payroll, run.id);
    expect(recon.filter((r) => r.beatName.endsWith(tag))).toHaveLength(4);
    const profit = await clientProfitability(payroll, run.id);
    const p = profit.find((x) => x.clientName === client.name)!;
    expect(p.contribution).toBeCloseTo(p.revenue - p.payroll - p.employerPension - p.otherCosts, 2);
    expect(p.otherCosts).toBeGreaterThan(0); // GUARDING contract → ITF/NSITF/insurance/… apply

    // AUDIT TRAIL
    const audit = await listAudit(admin, { take: 2000 });
    const actions = new Set(audit.map((a) => a.action));
    for (const a of [
      "CLIENT_CREATE",
      "CONTRACT_CREATE",
      "SALARY_STRUCTURE_CREATE",
      "BEAT_CREATE",
      "EMPLOYEE_CREATE",
      "EMPLOYEE_NUMBER_GENERATED",
      "EMPLOYEE_DEPLOYMENT",
      "STAFF_MOVEMENT_APPROVE",
      "ATTENDANCE_RECORD",
      "OVERTIME_ENTRY",
      "ARREARS_REQUEST",
      "DEDUCTION_ENTRY",
      "PAYROLL_CALCULATION",
      "PAYROLL_RECALCULATION",
      "PAYROLL_APPROVAL",
      "PAYROLL_LOCK",
      "LOCATION_EXCEPTION_RESOLVED",
    ])
      expect(actions, a).toContain(a);
  });
});
