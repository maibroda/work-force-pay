/**
 * HR lifecycle demo data for an already-seeded organization: employment contracts for the whole
 * workforce (a few ending soon / on probation so the alerts show something), a requisition with a
 * small candidate pipeline and an offer awaiting an answer, two employee-relations cases and a few
 * joiners with open onboarding steps.
 *
 * Idempotent — does nothing if the organization already has any employment contract — and never
 * touches existing records, so it is safe to run against a dev database:
 *     npx tsx prisma/hr-demo.ts
 * The main seed calls it at the end of a fresh seed.
 */
import "dotenv/config";
import type { Ctx } from "../src/lib/auth/context";
import { addDays, iso } from "../src/lib/dates";
import { db } from "../src/lib/db";
import { createContract } from "../src/server/services/contracts";
import { instantiateOnboardingTasks, todayUtc } from "../src/server/services/hr-policy";
import { nextNumber } from "../src/server/services/numbering";
import {
  addCandidate,
  approveOffer,
  approveRequisition,
  createOffer,
  createRequisition,
  markOfferSent,
  moveCandidate,
  recordInterviewFeedback,
  scheduleInterview,
} from "../src/server/services/recruitment";
import { raiseCase, setCaseStatus, addCaseNote } from "../src/server/services/relations";
import { createItem, createPack, issuePack, setPackLine } from "../src/server/services/inventory";
import { approveLoan, requestLoan } from "../src/server/services/loans";

/** One loan being repaid and one advance waiting for approval, for people who already have payroll history. Idempotent. */
export async function seedLoanDemo(orgId: string) {
  if (await db.staffLoan.count({ where: { organizationId: orgId } })) {
    console.log("• Loan demo data already present — skipped");
    return;
  }
  const [hrUser, finUser] = await Promise.all([
    db.user.findFirst({ where: { organizationId: orgId, role: "HR_ADMIN" } }),
    db.user.findFirst({ where: { organizationId: orgId, role: "FINANCE" } }),
  ]);
  if (!hrUser || !finUser) return;
  const asCtx = (u: typeof hrUser): Ctx => ({ userId: u.id, orgId, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: u.employeeId });
  const hr = asCtx(hrUser);
  const fin = asCtx(finUser);
  const paid = await db.payrollRecord.findMany({
    where: { organizationId: orgId, monthlyGross: { gt: 0 }, employee: { status: "ACTIVE" } },
    select: { employeeId: true },
    distinct: ["employeeId"],
    orderBy: { employeeNumber: "asc" },
    take: 12,
  });
  if (paid.length < 2) return;
  const loan = await requestLoan(hr, { employeeId: paid[10 % paid.length].employeeId, type: "LOAN", principal: 120000, installmentCount: 12, reason: "School fees for two children" });
  await approveLoan(fin, loan.id, "Within policy");
  await requestLoan(hr, { employeeId: paid[11 % paid.length].employeeId, type: "SALARY_ADVANCE", principal: 20000, reason: "Medical bill" });
  console.log("✔ Loan demo data seeded");
}

/** Stock list, a starter kit pack, and a couple of employees already holding it. Idempotent. */
export async function seedInventoryDemo(orgId: string) {
  if (await db.inventoryItem.count({ where: { organizationId: orgId } })) {
    console.log("• Inventory demo data already present — skipped");
    return;
  }
  const ops = await db.user.findFirst({ where: { organizationId: orgId, role: "OPERATIONS" } });
  if (!ops) return;
  const ctx: Ctx = { userId: ops.id, orgId, role: "OPERATIONS", name: ops.name, email: ops.email, employeeId: ops.employeeId };
  const shirt = await createItem(ctx, { name: "Uniform shirt", category: "UNIFORM", size: "L", unit: "pcs", reorderLevel: 20, openingQuantity: 60, openingUnitCost: 4500 });
  const trousers = await createItem(ctx, { name: "Uniform trousers", category: "UNIFORM", size: "34", unit: "pcs", reorderLevel: 20, openingQuantity: 45, openingUnitCost: 6000 });
  const boots = await createItem(ctx, { name: "Duty boots", category: "FOOTWEAR", size: "42", unit: "pair", reorderLevel: 10, openingQuantity: 18, openingUnitCost: 15000 });
  const beret = await createItem(ctx, { name: "Beret", category: "ACCESSORY", unit: "pcs", reorderLevel: 15, openingQuantity: 12, openingUnitCost: 2500 });
  const torch = await createItem(ctx, { name: "Torch", category: "EQUIPMENT", unit: "pcs", reorderLevel: 5, openingQuantity: 25, openingUnitCost: 3500 });
  const guard = await db.employeeCategory.findFirst({ where: { organizationId: orgId, code: "GUARD" } });
  const pack = await createPack(ctx, { name: "Guard starter kit", categoryId: guard?.id, description: "Standard first issue for every new guard" });
  for (const [item, quantity] of [[shirt, 2], [trousers, 2], [boots, 1], [beret, 1], [torch, 1]] as const)
    await setPackLine(ctx, pack.id, { itemId: item.id, quantity });
  const guards = await db.employee.findMany({
    where: { organizationId: orgId, status: "ACTIVE", categoryId: guard?.id },
    orderBy: { employeeNumber: "asc" },
    take: 3,
  });
  for (const g of guards.slice(0, 2)) await issuePack(ctx, g.id, pack.id);
  console.log("✔ Inventory demo data seeded");
}

export async function seedHrDemo(orgId: string) {
  if (await db.employmentContract.count({ where: { organizationId: orgId } })) {
    console.log("• HR demo data already present — skipped");
    return;
  }
  const user = async (role: Ctx["role"]): Promise<Ctx> => {
    const u = await db.user.findFirstOrThrow({ where: { organizationId: orgId, role } });
    return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: u.employeeId };
  };
  const hr = await user("HR_ADMIN");
  const admin = await user("COMPANY_ADMIN");
  const today = todayUtc();
  const employees = await db.employee.findMany({
    where: { organizationId: orgId, status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] } },
    include: { category: true },
    orderBy: { employeeNumber: "asc" },
  });
  if (!employees.length) return;

  // ── Contracts: the five demonstration cases first, then a permanent contract for everyone else ──
  const special = employees.slice(0, 5);
  const demo: Array<Parameters<typeof createContract>[1]> = [
    { type: "FIXED_TERM", startDate: iso(addDays(today, -340)), endDate: iso(addDays(today, 25)) },
    { type: "FIXED_TERM", startDate: iso(addDays(today, -320)), endDate: iso(addDays(today, 50)) },
    { type: "FIXED_TERM", startDate: iso(addDays(today, -370)), endDate: iso(addDays(today, -3)) },
    { type: "PROBATION", startDate: iso(addDays(today, -75)), probationMonths: 3 },
    { type: "PROBATION", startDate: iso(addDays(today, -100)), probationMonths: 3 },
  ].map((c, i) => ({ ...c, employeeId: special[i].id, jobTitle: special[i].category.name }) as never);
  for (const c of demo) await createContract(admin, c);

  const rest = employees.slice(special.length);
  await db.$transaction(async (tx) => {
    const rows = [];
    for (const e of rest)
      rows.push({
        organizationId: orgId,
        contractNumber: await nextNumber(tx, orgId, "EMPLOYMENT_CONTRACT"),
        employeeId: e.id,
        type: "PERMANENT" as const,
        jobTitle: e.category.name,
        startDate: e.employmentDate,
        noticePeriodDays: 30,
        createdBy: "Demo seed",
      });
    await tx.employmentContract.createMany({ data: rows });
  });

  // ── Joiners with open onboarding steps (the most recent hires) ──
  const joiners = [...employees].sort((a, b) => b.employmentDate.getTime() - a.employmentDate.getTime()).slice(0, 4);
  for (const e of joiners) {
    if (await db.onboardingTask.count({ where: { employeeId: e.id } })) continue;
    await instantiateOnboardingTasks(admin, e);
  }

  // ── Recruitment ──
  const guard = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: orgId, code: "GUARD" } });
  const supCat = await db.employeeCategory.findFirst({ where: { organizationId: orgId, code: "SUP" } });
  const ops = await db.department.findFirst({ where: { organizationId: orgId, code: "OPS" } });
  const open = await createRequisition(hr, {
    title: "Site Supervisor — Lagos Island",
    categoryId: (supCat ?? guard).id,
    departmentId: ops?.id,
    headcount: 2,
    employmentType: "PERMANENT",
    budgetedMonthlyGross: 280000,
    justification: "New client site going live next month needs two additional supervisors.",
  });
  await approveRequisition(admin, open.id, "Budgeted for Q4");
  await createRequisition(hr, {
    title: "Guard Commander — Abuja",
    categoryId: guard.id,
    departmentId: ops?.id,
    headcount: 1,
    employmentType: "FIXED_TERM",
    justification: "Cover for a 12-month client engagement.",
  });
  await addCandidate(hr, { requisitionId: open.id, firstName: "Chidinma", lastName: "Okoro", phone: "08031234501", source: "REFERRAL", expectedMonthlyGross: 260000 });
  const second = await addCandidate(hr, { requisitionId: open.id, firstName: "Tunde", lastName: "Bakare", phone: "08031234502", email: "tunde.bakare@example.com", source: "JOB_BOARD", expectedMonthlyGross: 275000 });
  await moveCandidate(hr, second.id, "SCREENING");
  const third = await addCandidate(hr, { requisitionId: open.id, firstName: "Amina", lastName: "Yusuf", phone: "08031234503", source: "AGENCY", expectedMonthlyGross: 270000 });
  const iv = await scheduleInterview(hr, { candidateId: third.id, scheduledAt: iso(addDays(today, -2)), interviewer: "Ada Okafor", mode: "IN_PERSON" });
  await recordInterviewFeedback(hr, iv.id, { score: 5, recommendation: "STRONG_HIRE", feedback: "Excellent supervisory experience and clear on the client's needs." });
  await moveCandidate(hr, third.id, "OFFER");
  const offer = await createOffer(hr, {
    candidateId: third.id,
    jobTitle: "Site Supervisor",
    monthlyGross: 270000,
    employmentType: "PERMANENT",
    probationMonths: 3,
    startDate: iso(addDays(today, 21)),
    setPayRate: true,
  });
  await approveOffer(admin, offer.id);
  await markOfferSent(hr, offer.id);

  // ── Employee relations ──
  const subject = employees[Math.min(9, employees.length - 1)];
  const misconduct = await raiseCase(hr, {
    employeeId: subject.id,
    type: "MISCONDUCT",
    severity: "MEDIUM",
    summary: "Reported asleep at post during night shift",
    description: "The site supervisor reported finding the guard asleep at the main gate at about 2am on two occasions this month.",
  });
  await setCaseStatus(hr, misconduct.id, "INVESTIGATING");
  await addCaseNote(hr, misconduct.id, { kind: "EVIDENCE", note: "CCTV footage for both nights requested from the client's security control room." });
  const linked = await db.user.findFirst({ where: { organizationId: orgId, role: "EMPLOYEE", employeeId: { not: null } } });
  if (linked)
    await raiseCase(
      { userId: linked.id, orgId, role: "EMPLOYEE", name: linked.name, email: linked.email, employeeId: linked.employeeId },
      {
        type: "GRIEVANCE",
        severity: "LOW",
        summary: "Overtime for last month not shown on my payslip",
        description: "I worked six extra hours at the client's request on two Saturdays but I can't see them on my payslip.",
      },
    );
  console.log("✔ HR lifecycle demo data seeded");
}

// Standalone: `npx tsx prisma/hr-demo.ts` seeds the demo org (code DSS) in the configured database.
if (process.argv[1] && /hr-demo\.(ts|js)$/.test(process.argv[1])) {
  db.organization
    .findUniqueOrThrow({ where: { code: "DSS" } })
    .then(async (o) => {
      await seedHrDemo(o.id);
      await seedInventoryDemo(o.id);
      await seedLoanDemo(o.id);
    })
    .then(() => db.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await db.$disconnect();
      process.exit(1);
    });
}
