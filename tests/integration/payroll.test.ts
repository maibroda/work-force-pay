import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { d } from "@/lib/dates";
import { num } from "@/lib/money";
import { DEDUCTION_AUTHORITY_ERROR } from "@/lib/payroll/engine";
import {
  approveOtherEarning,
  createDeduction,
  createOtherEarning,
  createOvertime,
} from "@/server/services/inputs";
import { recordAttendance, resolveMismatch } from "@/server/services/operations";
import {
  approveRun,
  createSupplementaryRun,
  currentRun,
  getPayslip,
  lockRun,
  overrideIssue,
  returnRun,
  runPayroll,
  submitForApproval,
} from "@/server/services/payroll";
import { loadRateBook } from "@/server/services/rates";
import { beatByName, ctxFor, employeeByNumber, periodFor } from "../helpers";

/** Runs in order against the seeded, OPEN September 2026 payroll. */
describe("September 2026 payroll (seeded)", () => {
  it("#14 / #15 payroll retrieves every location worked and the payslip shows all four", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const sep = await periodFor(ctx, 2026, 9);
    const run = (await currentRun(ctx, sep.id))!;
    const emp = await employeeByNumber(ctx, "EMP-000025");
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: emp.id } });
    const slip = await getPayslip(ctx, rec.id);
    const locs = slip!.locations as Array<{
      clientName: string;
      beatName: string;
      days: number;
      from: string;
      to: string;
    }>;
    expect(
      locs.map((l) => `${l.from.slice(8)}–${l.to.slice(8)} ${l.clientName} — ${l.beatName} (${l.days})`),
    ).toEqual([
      "01–10 ABC Bank — Victoria Island Branch (10)",
      "11–18 ABC Bank — Marina Branch (8)",
      "19–25 ABC Bank — Ikoyi Branch (7)",
      "26–30 XYZ Manufacturing — Lekki (5)",
    ]);
    expect(slip!.allocations.map((a) => a.beat?.name).sort()).toEqual([
      "Ikoyi Branch",
      "Lekki",
      "Marina Branch",
      "Victoria Island Branch",
    ]);
    // current location (Lekki) is NOT used as the only payroll location
    expect(num(rec.clientBilling)).toBeCloseTo(120000 * (25 / 30) + 135000 * (5 / 30), 2);
  });

  it("effective-dated agreed rates: June uses ₦100,000, July uses ₦120,000", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const con = await db.contract.findFirstOrThrow({
      where: { organizationId: ctx.orgId, contractNumber: "CON-GLB-2026" },
    });
    const cat = await db.employeeCategory.findFirstOrThrow({
      where: { organizationId: ctx.orgId, code: "GUARD" },
    });
    const book = await loadRateBook(db, ctx.orgId, d("2026-06-01"), d("2026-07-31"), 70);
    expect(
      book.resolve("x", { contractId: con.id, categoryId: cat.id, date: d("2026-06-15") })!.agreedRate,
    ).toBe(100000);
    expect(
      book.resolve("x", { contractId: con.id, categoryId: cat.id, date: d("2026-07-15") })!.agreedRate,
    ).toBe(120000);
  });

  it("#20 arrears are calculated from the previous period and included in the current payroll", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const emp = await employeeByNumber(ctx, "EMP-000010");
    const aug = await periodFor(ctx, 2026, 8);
    const sep = await periodFor(ctx, 2026, 9);
    const arr = await db.arrears.findFirstOrThrow({ where: { employeeId: emp.id, status: "APPROVED" } });
    const augRec = await db.payrollRecord.findFirstOrThrow({
      where: { employeeId: emp.id, run: { periodId: aug.id } },
    });
    expect(num(arr.originalAmount)).toBe(num(augRec.earnedGross));
    const factor = num(augRec.earnedGross) / num(augRec.monthlyGross);
    expect(num(arr.correctedAmount)).toBeCloseTo(98000 * factor, 1);
    expect(num(arr.difference)).toBeGreaterThan(0);
    const sepRec = await db.payrollRecord.findFirstOrThrow({
      where: { employeeId: emp.id, run: { periodId: sep.id } },
    });
    expect(num(sepRec.arrearsAmount)).toBe(num(arr.grossImpact));
  });

  it("#21 unauthorized deduction is rejected", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const sep = await periodFor(ctx, 2026, 9);
    const emp = await employeeByNumber(ctx, "EMP-000011");
    await expect(
      createDeduction(ctx, {
        employeeId: emp.id,
        deductionType: "PENALTY",
        amount: 5000,
        periodId: sep.id,
        reason: "No paperwork",
      }),
    ).rejects.toThrow(DEDUCTION_AUTHORITY_ERROR);
  });

  it("overtime is validated against the employee's client/location", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const sep = await periodFor(ctx, 2026, 9);
    const emp = await employeeByNumber(ctx, "EMP-000003"); // Victoria Island
    const wrong = await beatByName(ctx, "Kano Branch");
    await expect(
      createOvertime(ctx, {
        employeeId: emp.id,
        beatId: wrong.id,
        periodId: sep.id,
        date: "2026-09-02",
        hours: 4,
        approvalReference: "X",
      }),
    ).rejects.toThrow(/does not belong/);
    const vi = await beatByName(ctx, "Victoria Island Branch");
    await expect(
      createOvertime(ctx, {
        employeeId: emp.id,
        beatId: vi.id,
        periodId: sep.id,
        date: "2026-09-12",
        hours: 2,
      }),
    ).rejects.toThrow(/Duplicate overtime/);
  });

  it("#23 / #24 / #25 missing bank, client mismatch and location mismatch are flagged in validation", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const sep = await periodFor(ctx, 2026, 9);
    const run = (await currentRun(ctx, sep.id))!;
    const issues = await db.payrollValidationIssue.findMany({ where: { runId: run.id } });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("BANK_MISSING");
    expect(codes).toContain("CLIENT_MISMATCH");
    expect(codes).toContain("LOCATION_MISMATCH");
    expect(issues.find((i) => i.code === "CLIENT_MISMATCH")!.message).toMatch(
      /RED ALERT — Client mismatch detected/,
    );
    expect(issues.find((i) => i.code === "BANK_MISSING")!.message).toMatch(/EMP-000088/);
  });

  it("#26 payroll can be recalculated while open", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const fin = await ctxFor("FINANCE");
    const sep = await periodFor(ctx, 2026, 9);
    const emp = await employeeByNumber(ctx, "EMP-000006");
    const before = await db.payrollRecord.findFirstOrThrow({
      where: { employeeId: emp.id, run: { periodId: sep.id } },
    });
    const oe = await createOtherEarning(ctx, {
      employeeId: emp.id,
      periodId: sep.id,
      name: "Night allowance",
      amount: 7000,
      reason: "Approved night duty allowance",
    });
    await approveOtherEarning(fin, oe.id);
    const run = await runPayroll(ctx, sep.id);
    expect(run.calculationCount).toBeGreaterThanOrEqual(2);
    const after = await db.payrollRecord.findFirstOrThrow({ where: { employeeId: emp.id, runId: run.id } });
    expect(num(after.totalEarnings)).toBeCloseTo(num(before.totalEarnings) + 7000, 2);
  });

  it("#27 approval is blocked by critical errors; resolved & overridden payroll can be approved and locked", async () => {
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const fin = await ctxFor("FINANCE");
    const sep = await periodFor(payroll, 2026, 9);
    let run = (await currentRun(payroll, sep.id))!;
    await submitForApproval(payroll, run.id);
    await expect(approveRun(fin, run.id)).rejects.toThrow(/critical validation error/);

    // Resolve location exceptions through the operational workflow, then recalculate
    const mism = await db.workRegister.findMany({
      where: {
        organizationId: ops.orgId,
        locationMismatch: true,
        mismatchResolved: false,
        date: { gte: sep.startDate, lte: sep.endDate },
      },
    });
    expect(mism.length).toBe(2);
    await resolveMismatch(ops, {
      workRegisterId: mism[0].id,
      action: "ACCEPT_AS_RELIEF",
      note: "Approved one-day relief cover",
    });
    await resolveMismatch(ops, {
      workRegisterId: mism[1].id,
      action: "CORRECT_TO_ASSIGNED_BEAT",
      note: "Supervisor keyed the wrong beat",
    });
    await returnRun(fin, run.id, "Returned to payroll for location corrections");
    run = await runPayroll(payroll, sep.id);
    const loc = await db.payrollValidationIssue.count({
      where: { runId: run.id, category: "LOCATION", severity: "CRITICAL" },
    });
    expect(loc).toBe(0);

    // Remaining criticals (missing bank, duplicate account) need a documented Finance override
    const crit = await db.payrollValidationIssue.findMany({
      where: { runId: run.id, severity: "CRITICAL", overridden: false },
    });
    await expect(overrideIssue(fin, crit[0].id, "short")).rejects.toThrow(/documented reason/);
    for (const i of crit)
      await overrideIssue(
        fin,
        i.id,
        "Payment withheld pending HR bank verification — Finance memo FIN/2026/091",
      );
    await submitForApproval(payroll, run.id);
    await approveRun(fin, run.id);
    await lockRun(fin, run.id);
    expect((await db.payrollPeriod.findUniqueOrThrow({ where: { id: sep.id } })).status).toBe("LOCKED");
    // locking posts the payroll heads to the general ledger in the same step
    const journal = await db.journalEntry.findUniqueOrThrow({ where: { runId: run.id } });
    expect(journal.source).toBe("PAYROLL_LOCK");
    expect(num(journal.totalDebit)).toBe(num(journal.totalCredit));
  });

  it("#28 locked payroll cannot be directly edited", async () => {
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const sep = await periodFor(payroll, 2026, 9);
    await expect(runPayroll(payroll, sep.id)).rejects.toThrow(/locked/);
    const emp = await employeeByNumber(ops, "EMP-000003");
    const vi = await beatByName(ops, "Victoria Island Branch");
    await expect(
      recordAttendance(ops, [{ employeeId: emp.id, beatId: vi.id, date: "2026-09-05", status: "ABSENT" }]),
    ).rejects.toThrow(/locked/);
  });

  it("#29 supplementary payroll handles a post-lock correction without editing the locked run", async () => {
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const fin = await ctxFor("FINANCE");
    const sep = await periodFor(payroll, 2026, 9);
    const locked = (await currentRun(payroll, sep.id))!;
    const lockedNet = num(locked.totalNet);
    const emp = await employeeByNumber(payroll, "EMP-000012");
    const oe = await createOtherEarning(payroll, {
      employeeId: emp.id,
      periodId: sep.id,
      name: "Missed transport refund",
      amount: 12000,
      reason: "Omitted from September payroll",
    });
    await approveOtherEarning(fin, oe.id);
    const supp = await createSupplementaryRun(payroll, sep.id, "September correction #1");
    expect(supp.type).toBe("SUPPLEMENTARY");
    const recs = await db.payrollRecord.findMany({ where: { runId: supp.id } });
    expect(recs.map((r) => r.employeeNumber)).toContain("EMP-000012");
    const r12 = recs.find((r) => r.employeeNumber === "EMP-000012")!;
    expect(num(r12.totalEarnings)).toBe(12000);
    expect(num(r12.earnedGross)).toBe(0);
    expect(num((await db.payrollRun.findUniqueOrThrow({ where: { id: locked.id } })).totalNet)).toBe(
      lockedNet,
    );
  });
});
