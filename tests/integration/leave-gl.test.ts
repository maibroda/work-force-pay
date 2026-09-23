import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, d, iso } from "@/lib/dates";
import { leaveEligibility } from "@/lib/leave";
import { num, round2 } from "@/lib/money";
import type { Ctx } from "@/lib/auth/context";
import {
  applyForLeave,
  cancelLeave,
  decideLeave,
  getLeavePolicy,
  leaveBalances,
  listLeave,
  myLeave,
  updateLeavePolicy,
} from "@/server/services/leave";
import { closePeriod, listJournals, postRunToGl, saveMapping } from "@/server/services/accounting";
import { createPeriod } from "@/server/services/payroll";
import { ctxFor, periodFor } from "../helpers";

const asEmployee = (e: { id: string; firstName: string; lastName: string }, orgId: string): Ctx => ({
  userId: e.id,
  orgId,
  role: "EMPLOYEE",
  name: `${e.firstName} ${e.lastName}`,
  email: "",
  employeeId: e.id,
});

/** A Monday well after any leave the seed created. */
function farMonday() {
  let x = addDays(d(iso(new Date())), 45);
  while (x.getUTCDay() !== 1) x = addDays(x, 1);
  return x;
}

async function viGuards(orgId: string) {
  const today = d(iso(new Date()));
  const vi = await db.beat.findFirstOrThrow({
    where: { organizationId: orgId, name: "Victoria Island Branch" },
  });
  const deps = await db.deployment.findMany({
    where: { organizationId: orgId, beatId: vi.id, status: "ACTIVE" },
    include: { employee: true, beat: true },
  });
  const all = deps.map((x) => x.employee).filter((e) => e.status === "ACTIVE" && e.currentBeatId === vi.id);
  return {
    vi,
    due: all.filter((e) => leaveEligibility(e.employmentDate, today, 12).cycle),
    notDue: all.filter((e) => !leaveEligibility(e.employmentDate, today, 12).cycle),
  };
}

describe("annual leave", () => {
  it("defaults to 10 working days, due after 12 months", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const p = await getLeavePolicy(hr.orgId);
    expect(p.annualDays).toBe(10);
    expect(p.eligibilityMonths).toBe(12);
    expect(p.workingDaysPerWeek).toBe(5);
  });

  it("a guard whose leave is not yet due cannot apply", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const today = d(iso(new Date()));
    const newbie = (
      await db.employee.findMany({ where: { organizationId: hr.orgId, status: "ACTIVE" } })
    ).find((e) => !leaveEligibility(e.employmentDate, today, 12).cycle)!;
    expect(newbie).toBeTruthy();
    const start = farMonday();
    await expect(
      applyForLeave(asEmployee(newbie, hr.orgId), { startDate: iso(start), endDate: iso(addDays(start, 4)) }),
    ).rejects.toThrow(/not yet due/);
    const mine = await myLeave(asEmployee(newbie, hr.orgId));
    expect(mine!.balance.due).toBe(false);
  });

  it("guard applies, supervisor approves, days land in the work register as paid leave, then can be cancelled", async () => {
    const sup = await ctxFor("SUPERVISOR");
    const { due } = await viGuards(sup.orgId);
    const clean = (
      await Promise.all(
        due.map(async (e) =>
          (await db.leaveRequest.count({ where: { employeeId: e.id } })) === 0 ? e : null,
        ),
      )
    ).filter(Boolean)[0]!;
    expect(clean).toBeTruthy();
    const me = asEmployee(clean, sup.orgId);
    const start = farMonday();

    // 5 working days requested
    const req = await applyForLeave(me, {
      startDate: iso(start),
      endDate: iso(addDays(start, 4)),
      reason: "Test leave",
    });
    expect(req.status).toBe("PENDING");
    expect(req.workingDays).toBe(5);

    // days are reserved straight away
    let bal = (await myLeave(me))!.balance;
    expect(bal).toMatchObject({ entitled: 10, pending: 5, approved: 0, remaining: 5 });

    // overlap and over-balance are refused
    await expect(
      applyForLeave(me, { startDate: iso(addDays(start, 2)), endDate: iso(addDays(start, 3)) }),
    ).rejects.toThrow(/overlap/);
    const next = addDays(start, 7);
    await expect(applyForLeave(me, { startDate: iso(next), endDate: iso(addDays(next, 7)) })).rejects.toThrow(
      /only 5/,
    ); // Mon → next Mon = 6 working days
    await expect(applyForLeave(me, { startDate: "2020-01-06", endDate: "2020-01-10" })).rejects.toThrow(
      /past/,
    );

    // nobody but a permitted approver can decide; a guard can never approve their own leave
    await expect(decideLeave(me, req.id, "APPROVED")).rejects.toThrow();
    await expect(decideLeave(sup, req.id, "REJECTED")).rejects.toThrow(/reason/);

    // the supervisor of the guard's beat approves
    const done = await decideLeave(sup, req.id, "APPROVED");
    expect(done.request.status).toBe("APPROVED");
    expect(done.request.decidedBy).toBe(sup.name);
    expect(done.marked).toBe(5);
    const rows = await db.workRegister.findMany({
      where: { employeeId: clean.id, date: { gte: start, lte: addDays(start, 4) } },
    });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.attendanceStatus === "LEAVE" && r.source === "SYSTEM")).toBe(true);
    bal = (await myLeave(me))!.balance;
    expect(bal).toMatchObject({ pending: 0, approved: 5, remaining: 5 });

    // already decided
    await expect(decideLeave(sup, req.id, "APPROVED")).rejects.toThrow(/already approved/);

    // cancel before it starts → work register cleared, days returned
    await cancelLeave(me, req.id);
    expect(
      await db.workRegister.count({
        where: { employeeId: clean.id, date: { gte: start, lte: addDays(start, 4) } },
      }),
    ).toBe(0);
    bal = (await myLeave(me))!.balance;
    expect(bal).toMatchObject({ approved: 0, pending: 0, remaining: 10 });
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CANCELLED");
  });

  it("a supervisor only sees and decides leave for guards on their own beats", async () => {
    const sup = await ctxFor("SUPERVISOR");
    const hr = await ctxFor("HR_ADMIN");
    const { due } = await viGuards(sup.orgId);
    const stranger = (
      await db.employee.findMany({
        where: { organizationId: sup.orgId, status: "ACTIVE", currentBeat: { supervisorId: null } },
      })
    ).find((e) => leaveEligibility(e.employmentDate, d(iso(new Date())), 12).cycle)!;
    expect(stranger).toBeTruthy();
    const start = addDays(farMonday(), 14);
    const r = await applyForLeave(hr, {
      employeeId: stranger.id,
      startDate: iso(start),
      endDate: iso(addDays(start, 1)),
    });
    await expect(decideLeave(sup, r.id, "APPROVED")).rejects.toThrow(/not on a beat you supervise/);
    const visible = await listLeave(sup);
    expect(visible.find((x) => x.id === r.id)).toBeUndefined();
    // HR can decide it instead
    const ok = await decideLeave(hr, r.id, "APPROVED");
    expect(ok.request.status).toBe("APPROVED");
    await cancelLeave(hr, r.id);
    expect(due.length).toBeGreaterThan(0);
  });

  it("balances list shows who is due, and the policy is editable", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const { rows } = await leaveBalances(hr);
    expect(rows.some((r) => r.balance.due)).toBe(true);
    expect(rows.some((r) => !r.balance.due)).toBe(true);
    await expect(
      updateLeavePolicy(await ctxFor("OPERATIONS"), {
        annualDays: 12,
        eligibilityMonths: 12,
        workingDaysPerWeek: 5,
      }),
    ).rejects.toThrow();
    await updateLeavePolicy(hr, { annualDays: 12, eligibilityMonths: 12, workingDaysPerWeek: 5 });
    expect((await getLeavePolicy(hr.orgId)).annualDays).toBe(12);
    await updateLeavePolicy(hr, { annualDays: 10, eligibilityMonths: 12, workingDaysPerWeek: 5 });
  });
});

describe("general-ledger posting", () => {
  it("every locked payroll was posted to the GL automatically, balanced and reconciled to the run", async () => {
    const fin = await ctxFor("FINANCE");
    // Scoped to the seeded July/August runs (both 100% GUARDING) — other tests may lock further runs
    // of their own (e.g. an OUTSOURCING-only run), which legitimately have no uniform & kits.
    const runs = await db.payrollRun.findMany({
      where: {
        organizationId: fin.orgId,
        status: { in: ["LOCKED", "PAID"] },
        period: { year: 2026, month: { in: [7, 8] } },
      },
    });
    expect(runs.length).toBeGreaterThanOrEqual(2); // July & August
    for (const run of runs) {
      const j = await db.journalEntry.findUniqueOrThrow({
        where: { runId: run.id },
        include: { lines: true },
      });
      expect(j.source).toBe("PAYROLL_LOCK");
      expect(num(j.totalDebit)).toBe(num(j.totalCredit));
      const dr = round2(j.lines.reduce((a, l) => a + num(l.debit), 0));
      const cr = round2(j.lines.reduce((a, l) => a + num(l.credit), 0));
      expect(dr).toBe(cr);
      const credit = (head: string) =>
        round2(j.lines.filter((l) => l.headCode === head).reduce((a, l) => a + num(l.credit), 0));
      const debit = (head: string) =>
        round2(j.lines.filter((l) => l.headCode === head).reduce((a, l) => a + num(l.debit), 0));
      expect(credit("NET_PAY")).toBe(num(run.totalNet));
      expect(credit("PAYE")).toBe(num(run.totalPaye));
      expect(credit("PENSION_EE")).toBe(num(run.totalEmployeePension));
      expect(credit("PENSION_ER")).toBe(num(run.totalEmployerPension));
      expect(debit("PENSION_ER")).toBe(num(run.totalEmployerPension));
      // guarding contracts also carry ITF, NSITF, insurance, uniform & kits, recruitment/training
      // and annual leave reliever — each debited to its own expense account and credited to a payable
      expect(num(run.totalEmployerAddOns)).toBeGreaterThan(0);
      expect(credit("ITF")).toBe(num(run.totalItf));
      expect(debit("ITF")).toBe(num(run.totalItf));
      expect(j.lines.find((l) => l.headCode === "ITF")!.accountCode).toBe("5300");
      expect(credit("UNIFORM_KITS")).toBe(num(run.totalUniformKits));
      expect(num(run.totalUniformKits)).toBeGreaterThan(0); // seeded contracts are all GUARDING
      expect(num(run.totalOutsourcingLeaveAllowance)).toBe(0); // no seeded OUTSOURCING contract
      // total debits = gross earnings + employer pension + employer add-on costs
      expect(dr).toBeCloseTo(
        num(run.totalGross) + num(run.totalEmployerPension) + num(run.totalEmployerAddOns),
        0,
      );
      // each payroll head has its own account
      expect(j.lines.find((l) => l.headCode === "BASIC")!.accountCode).toBe("5100");
      expect(j.lines.find((l) => l.headCode === "PAYE")!.accountCode).toBe("2110");
    }
  });

  it("posting is idempotent — locking, closing or re-posting never double-posts", async () => {
    const fin = await ctxFor("FINANCE");
    const run = await db.payrollRun.findFirstOrThrow({
      where: { organizationId: fin.orgId, status: { in: ["LOCKED", "PAID"] } },
    });
    const before = await db.journalEntry.count({ where: { organizationId: fin.orgId } });
    const j1 = await postRunToGl(fin, run.id, "MANUAL_POST");
    const j2 = await postRunToGl(fin, run.id, "PAYROLL_CLOSE");
    expect(j1.id).toBe(j2.id);
    expect(await db.journalEntry.count({ where: { organizationId: fin.orgId } })).toBe(before);
  });

  it("a payroll head can be re-mapped to a different account", async () => {
    const fin = await ctxFor("FINANCE");
    const acct = await db.glAccount.findFirstOrThrow({ where: { organizationId: fin.orgId, code: "5199" } });
    await saveMapping(fin, {
      headCode: "HAZARD",
      headName: "Hazard allowance",
      headType: "EARNING",
      debitAccountId: acct.id,
    });
    const m = await db.payrollGlMapping.findFirstOrThrow({
      where: { organizationId: fin.orgId, headCode: "HAZARD" },
    });
    expect(m.debitAccountId).toBe(acct.id);
    await expect(
      saveMapping(await ctxFor("PAYROLL_ADMIN"), {
        headCode: "X",
        headName: "X",
        headType: "EARNING",
        debitAccountId: acct.id,
      }),
    ).rejects.toThrow();
  });

  it("closing a period keeps the ledger complete and cannot be repeated", async () => {
    const fin = await ctxFor("FINANCE");
    const july = await periodFor(fin, 2026, 7);
    const before = (await listJournals(fin)).length;
    const closed = await closePeriod(fin, july.id);
    expect(closed.status).toBe("CLOSED");
    expect((await listJournals(fin)).length).toBe(before); // already posted at lock — nothing doubled
    await expect(closePeriod(fin, july.id)).rejects.toThrow(/already closed/);
    // an open period cannot be closed (a fresh one, so this does not depend on test order)
    const fresh = await createPeriod(await ctxFor("PAYROLL_ADMIN"), 2027, 1);
    await expect(closePeriod(fin, fresh.id)).rejects.toThrow(/locked or paid/);
  });

  it("only finance/admin may manage the GL", async () => {
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const auditor = await ctxFor("AUDITOR");
    expect((await listJournals(auditor)).length).toBeGreaterThan(0);
    await expect(closePeriod(payroll, (await periodFor(payroll, 2026, 8)).id)).rejects.toThrow();
  });
});
