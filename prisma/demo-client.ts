/**
 * The ThreeRoots demo client: a fictional company, "Acme Facilities Ltd", with 30 employees across 3 sites, taken through one full payroll month with
 * the app's own services (onboarding, employee import, pay rates, the calendar, calculation, reconciliation, approval by someone else, locking, payment
 * batches, remittances). Used by the demo seed and by the acceptance test, so what is demonstrated is exactly what is tested.
 */
import { db } from "../src/lib/db";
import type { Ctx } from "../src/lib/auth/context";
import { DEFAULT_EARNINGS } from "../src/lib/payroll/structure";
import { onboardClient, grantAccess } from "../src/server/services/bureau";
import { commitEmployeeImport } from "../src/server/services/employee-import";
import { createPayRate } from "../src/server/services/employees";
import { generateCalendar, markInput } from "../src/server/services/payroll-calendar";
import { setVariancePolicy, signOffReconciliation } from "../src/server/services/payroll-controls";
import { approveRun, createPeriod, lockRun, runPayroll, submitForApproval } from "../src/server/services/payroll";
import { createPaymentBatches, generateRemittances } from "../src/server/services/payments";
import { INPUT_KINDS } from "../src/lib/payroll-calendar";
import { clientApproveRun, inviteClientUser, setClientApprovalRequired } from "../src/server/services/portal";
import { raiseQuery, replyToQuery } from "../src/server/services/client-queries";
import { proposeRelease, publishRelease, verifyRelease } from "../src/server/services/rule-library";

/** Bureau staff, as they are in the bureau's own organization. */
export type DemoStaff = { founder: Ctx; officer: Ctx; reviewer: Ctx; hr: Ctx };

const FIRST = ["Adebayo", "Ngozi", "Emeka", "Funke", "Ibrahim", "Chiamaka", "Tunde", "Aisha", "Obinna", "Yetunde", "Musa", "Blessing", "Segun", "Halima", "Chidi", "Folake", "Usman", "Amaka", "Kunle", "Zainab", "Ifeanyi", "Bukola", "Sani", "Ngo", "Damilola", "Kelechi", "Hauwa", "Tosin", "Uche", "Maryam"];
const LAST = ["Adeyemi", "Okonkwo", "Eze", "Balogun", "Abubakar", "Nwosu", "Ogunleye", "Lawal", "Okafor", "Bakare", "Danjuma", "Igwe", "Adeleke", "Yusuf", "Nnamdi", "Coker", "Garba", "Obi", "Salami", "Mohammed", "Chukwu", "Fashola", "Bello", "Etim", "Ajayi", "Onyema", "Idris", "Ola", "Nweke", "Sule"];
const BANKS = ["GTBank", "Access Bank", "Zenith Bank", "UBA", "First Bank", "Sterling Bank"];
const PFAS = ["Stanbic IBTC Pension", "ARM Pension", "Premium Pension"];
const SITES = [{ code: "LAG", name: "Lagos HQ" }, { code: "ABJ", name: "Abuja Office" }, { code: "PHC", name: "Port Harcourt Depot" }];
export const DEMO_MONTH = { year: 2026, month: 10 };

/** The 30 employees as the CSV a client would send: 3 sites, a few supervisors, two October joiners. */
export function demoEmployeesCsv(): string {
  const head = "First Name,Last Name,Gender,Date of Birth,Phone,Employment Date,Category,Department,Bank Name,Account Number,Account Name,Tax ID,Pension PIN,PFA";
  const rows = Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    const first = FIRST[i];
    const last = LAST[(i * 7) % 30];
    const dob = `${String((i % 27) + 1).padStart(2, "0")}/${String((i % 12) + 1).padStart(2, "0")}/${1980 + (i % 15)}`;
    const joined = n >= 29 ? "12/10/2026" : `01/${String((i % 9) + 1).padStart(2, "0")}/${2024 + (i % 2)}`;
    return [
      first, last, i % 2 ? "Female" : "Male", dob, `0803${String(1000000 + i * 3571).slice(-7)}`, joined, n % 6 === 0 ? "SUPV" : "STAFF", SITES[i % 3].code,
      BANKS[i % BANKS.length], `20${String(10000000 + i * 7919).slice(-8)}`, `${first} ${last}`.toUpperCase(), `TIN${String(40000000 + i * 131)}`, `PEN${String(100000000000 + i * 977)}`, PFAS[i % PFAS.length],
    ].join(",");
  });
  return [head, ...rows].join("\r\n");
}

const grossFor = (i: number) => ((i + 1) % 6 === 0 ? 450000 : 150000 + (i % 7) * 50000);

/**
 * Puts the bureau's own PAYE, pension and employer-contribution rules in force on the date through the Statutory Rule Library, as the bureau must before a
 * client goes live (rule 3): each proposed, signed by HR and by Finance (neither the proposer), and published to its clients. The bureau needs at least one
 * client to publish to.
 */
export async function verifyBureauRules(staff: DemoStaff, bureauId: string, on = "2026-10-31") {
  const day = new Date(`${on}T00:00:00Z`);
  const inForce = { effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] };
  const tax = await db.taxRule.findFirstOrThrow({ where: { organizationId: bureauId, ...inForce }, orderBy: { effectiveFrom: "desc" } });
  const pension = await db.pensionRule.findFirstOrThrow({ where: { organizationId: bureauId, ...inForce }, orderBy: { effectiveFrom: "desc" } });
  const employer = await db.employerCostRule.findFirstOrThrow({ where: { organizationId: bureauId, ...inForce }, orderBy: { effectiveFrom: "desc" } });
  for (const [kind, ruleId] of [["TAX", tax.id], ["PENSION", pension.id], ["EMPLOYER_COST", employer.id]] as const) {
    const rel = await proposeRelease(staff.officer, { kind, ruleId, summary: "Checked against the current schedule", source: "Nigeria Tax Act 2025 and Pension Reform Act schedules" } as never);
    await verifyRelease(staff.hr, rel.id, "Checked every figure against the published schedule");
    await verifyRelease(staff.reviewer, rel.id, "Agrees with the published schedule");
    await publishRelease(staff.officer, rel.id);
  }
}

export async function buildDemoClient(staff: DemoStaff, opts: { name?: string; code?: string } = {}) {
  const bureauId = staff.founder.orgId;
  const { client } = await onboardClient(staff.founder, {
    name: opts.name ?? "Acme Facilities Ltd",
    code: opts.code ?? "ACMEFAC",
    package: "PAYROLL_COMPLIANCE",
    startDate: "2026-10-01",
    termMonths: 12,
    perEmployeeRate: 2500,
    monthlyMinimum: 50000,
    onboardingFee: 100000,
    contactName: "Mrs Funmi Bello",
    contactEmail: "payroll@acmefacilities.example",
    contactPhone: "08030000000",
    slaTerms: "Inputs by the 20th; draft within 3 working days; client approval within 2; pay on the 28th.",
    dpaReference: "DPA-ACME-2026-001",
    dpaSignedAt: "2026-09-28",
  } as never);
  // the people who work on this client; the founder reaches every client without a grant
  for (const s of [staff.officer, staff.reviewer, staff.hr]) await grantAccess(staff.founder, s.userId, client.id);
  // this is a production client, so its payroll is gated: the bureau's statutory rules are put through the library first, then the engagement goes live
  await verifyBureauRules(staff, bureauId);
  await db.clientEngagement.update({ where: { clientOrganizationId: client.id }, data: { status: "ACTIVE" } });
  const as = (c: Ctx): Ctx => ({ ...c, orgId: client.id, homeOrgId: bureauId });
  const [founder, officer, reviewer, hr] = [staff.founder, staff.officer, staff.reviewer, staff.hr].map(as);

  // the client's own set-up: how it pays, who works where
  await db.salaryStructure.create({
    data: {
      organizationId: client.id, code: "STD", name: "Standard salary structure", description: "Percentages of monthly gross.", isDefault: true, status: "ACTIVE", effectiveFrom: new Date("2020-01-01T00:00:00Z"),
      components: { create: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE", percentage: c.percentage!, taxable: true, pensionable: c.pensionable, sortOrder: i + 1 })) },
    },
  });
  await db.employeeCategory.createMany({ data: [{ organizationId: client.id, code: "STAFF", name: "Staff" }, { organizationId: client.id, code: "SUPV", name: "Supervisor" }] });
  await db.department.createMany({ data: SITES.map((s) => ({ organizationId: client.id, code: s.code, name: s.name })) });

  // the client's staff arrive as a file, and each gets a monthly gross
  const imported = await commitEmployeeImport(hr, { csv: demoEmployeesCsv(), fileName: "acme-staff-october-2026.csv" });
  const employees = await db.employee.findMany({ where: { organizationId: client.id }, orderBy: { employeeNumber: "asc" } });
  for (const [i, e] of employees.entries())
    await createPayRate(hr, { employeeId: e.id, monthlyGross: grossFor(i), structureCode: "STD", reason: "Offer letter", approvedBy: "Mrs Funmi Bello", effectiveFrom: e.employmentDate >= new Date("2026-10-01T00:00:00Z") ? e.employmentDate.toISOString().slice(0, 10) : "2026-01-01" });

  // the client's own approver, who signs the payroll off in the portal before it can be locked
  const invited = await inviteClientUser(founder, { name: "Mrs Funmi Bello", email: `approver@${(opts.code ?? "acmefac").toLowerCase()}.test`, role: "CLIENT_APPROVER" });
  await setClientApprovalRequired(founder, true);
  const approver: Ctx = { userId: invited.id, orgId: client.id, role: "CLIENT_APPROVER", name: invited.name, email: invited.email, employeeId: null };
  const invitedHr = await inviteClientUser(founder, { name: "Mr Tunde Ola", email: `hr@${(opts.code ?? "acmefac").toLowerCase()}.test`, role: "CLIENT_HR" });
  const hrContact: Ctx = { userId: invitedHr.id, orgId: client.id, role: "CLIENT_HR", name: invitedHr.name, email: invitedHr.email, employeeId: null };

  // the month: dates, inputs received, calculation, reconciliation, approval by someone else, lock, payments
  await setVariancePolicy(founder, { headcountPct: 5, employeePct: 20, totalPct: 10, minAmount: 5000, reconciliationRequired: true } as never);
  const period = await createPeriod(officer, DEMO_MONTH.year, DEMO_MONTH.month);
  await generateCalendar(officer, period.id);
  for (const kind of INPUT_KINDS) await markInput(officer, period.id, kind, kind === "LOANS" ? "NOT_APPLICABLE" : "RECEIVED", kind === "LOANS" ? "No staff loans this month" : "Sent by the client's HR by email, 19 Oct");
  const run = await runPayroll(officer, period.id);
  return { client, bureauId, as, founder, officer, reviewer, hr, approver, hrContact, employees, imported, period, run };
}

/** Takes the calculated month on to a locked, payable payroll: reconciled, submitted, approved and locked by someone else, then batches and remittances. */
export async function finishDemoMonth(d: Awaited<ReturnType<typeof buildDemoClient>>) {
  await signOffReconciliation(d.officer, d.run.id, "First payroll for this client; opening run");
  await submitForApproval(d.officer, d.run.id);
  await approveRun(d.reviewer, d.run.id);
  await clientApproveRun(d.approver, d.run.id, "Figures checked against our records.");
  await lockRun(d.reviewer, d.run.id);
  const batches = await createPaymentBatches(d.reviewer, d.run.id);
  await generateRemittances(d.reviewer, d.run.id);
  // a question from the client, answered by the bureau
  const q = await raiseQuery(d.hrContact, { subject: "Pay date for November", category: "PAYROLL", body: "Will November's salaries be paid on the 28th again, or earlier because of the weekend?" });
  await replyToQuery(d.officer, q.id, "The 28th falls on a Saturday, so the pay date is Friday the 27th. We will confirm when the draft is ready.");
  return { batches };
}
