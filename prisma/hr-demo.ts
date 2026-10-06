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
import { addContact, addGuarantor, rejectGuarantor, verifyGuarantor } from "../src/server/services/personal-records";
import { approveAppraisal, assignReviewer, launchCycle, saveReview, saveSelfAssessment, submitReview } from "../src/server/services/appraisals";

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

/** Three data access requests: one overdue, one due soon with identity checked, one completed. Idempotent. */
export async function seedDataRequestDemo(orgId: string) {
  if (await db.dataAccessRequest.count({ where: { organizationId: orgId } })) {
    console.log("• Data access request demo data already present — skipped");
    return;
  }
  const staff = await db.employee.findMany({ where: { organizationId: orgId, status: "ACTIVE" }, orderBy: { employeeNumber: "asc" }, take: 3 });
  if (staff.length < 3) return;
  const today = todayUtc();
  const mk = async (i: number, over: { receivedAgo: number; verified?: boolean; done?: boolean; requester?: string; channel: string }) =>
    db.dataAccessRequest.create({
      data: {
        organizationId: orgId,
        requestNumber: await db.$transaction((tx) => nextNumber(tx, orgId, "DATA_REQUEST")),
        employeeId: staff[i].id,
        requesterName: over.requester ?? `${staff[i].firstName} ${staff[i].lastName}`,
        channel: over.channel,
        receivedOn: addDays(today, -over.receivedAgo),
        dueOn: addDays(today, 30 - over.receivedAgo),
        createdBy: "Seed",
        ...(over.verified || over.done ? { identityVerified: true, identityNote: "Shown staff ID card at the HR office", verifiedBy: "Seed HR" } : {}),
        ...(over.done
          ? {
              exportedAt: addDays(today, -over.receivedAgo + 6),
              exportChecksum: "0".repeat(64),
              exportSections: { profile: 1, pay: 6 },
              status: "FULFILLED" as const,
              handledBy: "Seed HR",
              completedOn: addDays(today, -over.receivedAgo + 6),
              completionNote: "Copy handed over in person",
            }
          : {}),
      },
    });
  await mk(0, { receivedAgo: 40, channel: "Email" }); // overdue, identity not yet checked
  await mk(1, { receivedAgo: 25, verified: true, channel: "In person" }); // due in 5 days
  await mk(2, { receivedAgo: 60, done: true, channel: "Letter" }); // answered
  console.log("✔ Data access request demo data seeded");
}

/** Three policies, one with a recent second version, and acknowledgements in every state. Idempotent. */
export async function seedPolicyDemo(orgId: string) {
  if (await db.companyPolicy.count({ where: { organizationId: orgId } })) {
    console.log("• Policy demo data already present — skipped");
    return;
  }
  const guard = await db.employeeCategory.findFirst({ where: { organizationId: orgId, code: "GUARD" } });
  const today = todayUtc();
  const mk = async (title: string, summary: string, categoryId: string | null, graceDays: number, versions: Array<{ ago: number; body: string; changeSummary?: string }>) => {
    const p = await db.companyPolicy.create({ data: { organizationId: orgId, title, summary, categoryId, graceDays, createdBy: "Seed" } });
    const out = [];
    for (const [i, v] of versions.entries())
      out.push(await db.policyVersion.create({ data: { organizationId: orgId, policyId: p.id, version: i + 1, effectiveDate: addDays(today, -v.ago), body: v.body, changeSummary: v.changeSummary ?? null, publishedBy: "Seed" } }));
    return { p, versions: out };
  };
  const conduct = await mk("Code of Conduct", "How we expect every member of staff to behave on and off duty", null, 14, [
    { ago: 400, body: `1. Be honest and report fraud or theft.
2. Treat colleagues, clients and the public with respect.
3. Report for duty on time, in full uniform, and sober.
4. Never leave a post without being relieved.` },
    { ago: 20, body: `1. Be honest and report fraud or theft.
2. Treat colleagues, clients and the public with respect.
3. Report for duty on time, in full uniform, and sober.
4. Never leave a post without being relieved.
5. Do not post photographs of client premises or colleagues on social media.`, changeSummary: "Added a social-media section (point 5)" },
  ]);
  const data = await mk("Data Protection Notice", "How the company collects and protects personal data (NDPA)", null, 14, [
    { ago: 200, body: `The company collects the personal data needed to employ and pay you. It is kept securely, shared only where the law requires, and removed when it is no longer needed. You may ask to see or correct your data through HR.` },
  ]);
  const force = guard
    ? await mk("Use of Force & Escort Procedures", "Rules for guards on the use of force and on escort duty", guard.id, 30, [
        { ago: 100, body: `Use the minimum force necessary. Always report any use of force to your supervisor within the hour. Escort duties require two guards unless the client's order says otherwise.` },
      ])
    : null;
  const staff = await db.employee.findMany({ where: { organizationId: orgId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, orderBy: { employeeNumber: "asc" }, select: { id: true, categoryId: true } });
  const acks: Array<{ organizationId: string; versionId: string; employeeId: string; acknowledgedAt: Date; method: "SELF" | "RECORDED"; recordedBy?: string; note?: string }> = [];
  const add = (versionId: string, employeeId: string, daysAgo: number, recorded: boolean) =>
    acks.push({ organizationId: orgId, versionId, employeeId, acknowledgedAt: addDays(today, -daysAgo), method: recorded ? "RECORDED" : "SELF", ...(recorded ? { recordedBy: "Seed HR", note: "Signed sheet, file HR/POL/2026" } : {}) });
  for (const [i, e] of staff.entries()) {
    if (i % 4 !== 0) add(conduct.versions[1].id, e.id, 10 + (i % 8), i % 11 === 0); // the new version: a quarter are overdue
    else if (i % 8 === 0) add(conduct.versions[0].id, e.id, 300, false); // acknowledged the old one only
    if (i % 3 !== 0) add(data.versions[0].id, e.id, 150 - (i % 30), i % 13 === 0);
    if (force && e.categoryId === guard!.id && i % 5 !== 2) add(force.versions[0].id, e.id, 60, false);
  }
  await db.policyAcknowledgement.createMany({ data: acks });
  console.log("✔ Policy demo data seeded");
}

/** Three required courses and certificates in every state — valid, expiring, expired, missing, new joiner. Idempotent. */
export async function seedTrainingDemo(orgId: string) {
  if (await db.trainingRequirement.count({ where: { organizationId: orgId } })) {
    console.log("• Training demo data already present — skipped");
    return;
  }
  const guard = await db.employeeCategory.findFirst({ where: { organizationId: orgId, code: "GUARD" } });
  await db.trainingRequirement.createMany({
    data: [
      { organizationId: orgId, courseName: "First Aid", description: "Basic first-aid certificate, renewed every two years", graceDays: 30 },
      { organizationId: orgId, courseName: "Fire Safety Awareness", description: "Fire marshal basics for every post", graceDays: 60 },
      ...(guard ? [{ organizationId: orgId, courseName: "Basic Security Guard Training", description: "Initial guard-force training", categoryId: guard.id, graceDays: 30 }] : []),
    ],
  });
  const today = todayUtc();
  const staff = await db.employee.findMany({ where: { organizationId: orgId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, orderBy: { employeeNumber: "asc" }, select: { id: true, categoryId: true } });
  const rows = staff.flatMap((e, i) => {
    const cert = (courseName: string, expiresInDays: number | null, provider: string) => ({
      organizationId: orgId,
      employeeId: e.id,
      courseName,
      provider,
      certificateNumber: `${courseName.slice(0, 2).toUpperCase()}-${1000 + i}`,
      issueDate: addDays(today, -300),
      expiryDate: expiresInDays === null ? null : addDays(today, expiresInDays),
      status: expiresInDays !== null && expiresInDays < 0 ? ("EXPIRED" as const) : ("VALID" as const),
      recordedBy: "Seed",
    });
    const out = [];
    if (i % 7 === 0) out.push(cert("First Aid", -40, "Red Cross")); // expired
    else if (i % 7 === 1) out.push(cert("First Aid", 30, "Red Cross")); // expiring soon
    else if (i % 7 !== 2) out.push(cert("First Aid", 400, "Red Cross")); // (i % 7 === 2 has none: missing)
    if (i % 5 !== 3) out.push(cert("fire safety awareness", 500, "State Fire Service")); // different case on purpose
    if (e.categoryId === guard?.id && i % 9 !== 4) out.push(cert("Basic Security Guard Training", null, "Company academy")); // never expires
    return out;
  });
  await db.employeeTraining.createMany({ data: rows });
  console.log("✔ Training demo data seeded");
}

/** One review cycle with appraisals in every state: waiting, self-assessed, awaiting sign-off, signed off. Idempotent. */
export async function seedAppraisalDemo(orgId: string) {
  if (await db.appraisalCycle.count({ where: { organizationId: orgId } })) {
    console.log("• Appraisal demo data already present — skipped");
    return;
  }
  const [hrUser, adminUser, supUser] = await Promise.all([
    db.user.findFirst({ where: { organizationId: orgId, role: "HR_ADMIN" } }),
    db.user.findFirst({ where: { organizationId: orgId, role: "COMPANY_ADMIN" } }),
    db.user.findFirst({ where: { organizationId: orgId, role: "SUPERVISOR", active: true } }),
  ]);
  if (!hrUser || !adminUser || !supUser) return;
  const asCtx = (u: typeof hrUser): Ctx => ({ userId: u.id, orgId, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: u.employeeId });
  const hr = asCtx(hrUser);
  const admin = asCtx(adminUser);
  const sup = asCtx(supUser);
  const staff = await db.employee.findMany({ where: { organizationId: orgId, status: "ACTIVE", NOT: { id: supUser.employeeId ?? "" }, employmentDate: { lte: new Date("2026-01-01T00:00:00Z") } }, orderBy: { employeeNumber: "asc" }, take: 6 });
  if (staff.length < 4) return;
  const end = iso(todayUtc());
  const r = await launchCycle(hr, { name: "2026 mid-year review", kind: "ANNUAL", periodStart: "2026-01-01", periodEnd: end, dueDate: iso(addDays(todayUtc(), 21)), employeeIds: staff.map((e) => e.id) });
  const rows = await db.appraisal.findMany({ where: { cycleId: r.cycle.id }, include: { ratings: true }, orderBy: { employee: { employeeNumber: "asc" } } });
  for (const a of rows) if (a.reviewerUserId !== sup.userId) await assignReviewer(hr, a.id, sup.userId);
  const rate = async (a: (typeof rows)[number], pattern: number[]) =>
    saveReview(sup, a.id, {
      ratings: a.ratings.map((x, i) => ({ criterionId: x.criterionId, rating: pattern[i % pattern.length], comment: pattern[i % pattern.length] >= 5 || pattern[i % pattern.length] <= 2 ? "See the incident and commendation records" : undefined })),
      strengths: "Reliable on night shifts and well regarded by the client",
      improvements: "Keep the occurrence book up to date",
      goals: "Complete first-aid refresher; lead one shift handover a week",
      reviewerComment: "A dependable member of the team.",
      recommendation: "INCREMENT",
    });
  // 0: signed off; 1: awaiting sign-off; 2: self-assessed, review under way; the rest: not started
  const self = async (a: (typeof rows)[number]) => {
    const e = staff.find((s) => s.id === a.employeeId)!;
    await saveSelfAssessment({ userId: `self-${e.id}`, orgId, role: "EMPLOYEE", name: e.firstName, email: "", employeeId: e.id }, a.id, { ratings: a.ratings.map((x) => ({ criterionId: x.criterionId, rating: 4 })), comment: "I've been consistent this half-year." });
  };
  await self(rows[0]);
  await rate(rows[0], [4, 4, 3, 5, 4, 3]);
  await submitReview(sup, rows[0].id);
  await approveAppraisal(admin, rows[0].id, "Agreed with the reviewer");
  await rate(rows[1], [3, 3, 4, 3, 2, 3]);
  await submitReview(sup, rows[1].id);
  await self(rows[2]);
  console.log("✔ Appraisal demo data seeded");
}

/** Next of kin, emergency contacts, dependants and guarantors in every state, for the first few staff. Idempotent. */
export async function seedPersonalRecordsDemo(orgId: string) {
  if (await db.employeeContact.count({ where: { organizationId: orgId } })) {
    console.log("• Personal records demo data already present — skipped");
    return;
  }
  const hrUser = await db.user.findFirst({ where: { organizationId: orgId, role: "HR_ADMIN" } });
  if (!hrUser) return;
  const hr: Ctx = { userId: hrUser.id, orgId, role: "HR_ADMIN", name: hrUser.name, email: hrUser.email, employeeId: hrUser.employeeId };
  const staff = await db.employee.findMany({ where: { organizationId: orgId, status: "ACTIVE" }, orderBy: { employeeNumber: "asc" }, take: 10 });
  const surnames = ["Okafor", "Bello", "Adeyemi", "Eze", "Musa", "Nwosu", "Ibrahim", "Obi", "Yusuf", "Balogun"];
  let phone = 8030000100;
  const next = () => "0" + String(phone++);
  for (const [i, e] of staff.entries()) {
    if (i >= 8) break; // the last two have nothing on file, so the "missing" lists have rows
    const sn = surnames[i];
    await addContact(hr, e.id, { kind: "NEXT_OF_KIN", fullName: `${i % 2 ? "Amaka" : "Tunde"} ${sn}`, relationship: i % 2 ? "Spouse" : "Parent", phone: next(), address: "14 Market Road, Lagos", isBeneficiary: i < 3, benefitSharePct: i === 0 ? 60 : i < 3 ? 100 : undefined });
    if (i !== 5) await addContact(hr, e.id, { kind: "EMERGENCY_CONTACT", fullName: `Ifeanyi ${sn}`, relationship: "Sibling", phone: next() });
    if (i === 0) await addContact(hr, e.id, { kind: "DEPENDANT", fullName: "Chioma Okafor", relationship: "Child", dateOfBirth: "2016-05-09", isBeneficiary: true, benefitSharePct: 40 });
    if (i === 1) await addContact(hr, e.id, { kind: "REFEREE", fullName: "Pastor Samuel Adebayo", relationship: "Pastor / Imam", phone: next() });
  }
  const g = (i: number, k: number, extra: Record<string, unknown> = {}) => ({
    fullName: `${["Chief", "Alhaji", "Mrs", "Mr"][k % 4]} ${surnames[(i + k + 3) % 10]}`,
    relationship: k % 2 ? "Relative" : "Friend",
    phone: next(),
    address: "7 Unity Close, Ikeja, Lagos",
    occupation: "Trader",
    idType: "NIN",
    idNumber: `NIN${70000000 + i * 10 + k}`,
    formReference: `GF-${2026}-${i}${k}`,
    yearsKnown: 5 + k,
    ...extra,
  });
  for (const [i, e] of staff.entries()) {
    if (i > 4) break;
    const first = await addGuarantor(hr, e.id, g(i, 0));
    const second = await addGuarantor(hr, e.id, g(i, 1, i === 4 ? { idType: undefined, idNumber: undefined } : {}));
    if (i <= 2) await verifyGuarantor(hr, first.id, "Called and visited the address");
    if (i <= 1) await verifyGuarantor(hr, second.id, "Called and visited the address");
    if (i === 4) await rejectGuarantor(hr, first.id, "Number is not in service");
  }
  console.log("✔ Personal records demo data seeded");
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
      await seedPersonalRecordsDemo(o.id);
      await seedTrainingDemo(o.id);
      await seedAppraisalDemo(o.id);
      await seedPolicyDemo(o.id);
      await seedDataRequestDemo(o.id);
    })
    .then(() => db.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await db.$disconnect();
      process.exit(1);
    });
}
