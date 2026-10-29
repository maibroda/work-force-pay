/**
 * The bureau's launch checklist: what must be true before real clients' payroll runs through the app. Judges what the app can see for itself
 * (rate tables, email, secrets, the scheduler, staff two-factor, clients' data-processing terms) and records what only a person can confirm
 * (bank codes against the bank's guide, a real payslip email, a restored backup), with who, when and what they did.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { sendEmail } from "@/lib/email";
import {
  checkAppUrl,
  checkEmail,
  checkRules,
  checkAuditSeal,
  checkScheduler,
  checkSecrets,
  JOBS,
  MANUAL_CHECKS,
  MANUAL_KEYS,
  RATE_POINTS,
  summarise,
  type CheckResult,
  type CheckStatus,
  type JobRunRow,
  type RuleRow,
} from "@/lib/launch-readiness";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { staffTwoFactorStatus } from "./bureau";

export type ChecklistItem = {
  key: string;
  title: string;
  status: CheckStatus;
  evidence: string[];
  /** What to do, for the items a person confirms or fixes. */
  how?: string;
  /** Points the person doing it should settle. */
  points?: readonly string[];
  manual: boolean;
  confirmed?: { by: string; at: Date; note: string };
};

async function bureauFor(ctx: Ctx) {
  const org = await db.organization.findUnique({ where: { id: ctx.homeOrgId ?? ctx.orgId } });
  if (!org?.isBureau) throw new BusinessError("The launch checklist belongs to a payroll bureau.");
  return org;
}

/** The master rules in force today, each with how far through verification its release has got. */
async function ruleRows(bureauId: string, today: Date) {
  const inForce = { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] };
  const [tax, pension, employer, releases] = await Promise.all([
    db.taxRule.findMany({ where: { organizationId: bureauId, active: true, ...inForce } }),
    db.pensionRule.findMany({ where: { organizationId: bureauId, ...inForce } }),
    db.employerCostRule.findMany({ where: { organizationId: bureauId, ...inForce } }),
    db.ruleRelease.findMany({ where: { bureauOrganizationId: bureauId, status: { not: "WITHDRAWN" } }, include: { verifications: { select: { id: true } } } }),
  ]);
  const rank = { PROPOSED: 1, VERIFIED: 2, PUBLISHED: 3 } as const;
  const best = new Map<string, { status: keyof typeof rank; verifications: number }>();
  for (const r of releases) {
    const cur = best.get(r.ruleId);
    if (!cur || rank[r.status as keyof typeof rank] > rank[cur.status]) best.set(r.ruleId, { status: r.status as keyof typeof rank, verifications: r.verifications.length });
  }
  const row = (id: string, label: string): RuleRow => ({ label, release: best.get(id)?.status ?? null, verifications: best.get(id)?.verifications ?? 0 });
  const rows = [
    ...tax.map((r) => row(r.id, `PAYE ${r.code} v${r.version}`)),
    ...pension.map((r) => row(r.id, `Pension v${r.version}`)),
    ...employer.map((r) => row(r.id, `Employer contributions v${r.version}`)),
  ];
  const missing = [tax.length ? null : "PAYE", pension.length ? null : "pension", employer.length ? null : "employer contribution"].filter((x): x is string => !!x);
  return checkRules(rows, missing);
}

export async function launchChecklist(ctx: Ctx, now = new Date(), env: Record<string, string | undefined> = process.env) {
  assertCan(ctx, "bureau.view");
  const bureau = await bureauFor(ctx);
  const today = new Date(`${iso(now)}T00:00:00Z`);

  const [rules, runs, staff, clients, confirmations] = await Promise.all([
    ruleRows(bureau.id, today),
    Promise.all(JOBS.map((j) => db.jobRun.findFirst({ where: { name: j.name }, orderBy: { startedAt: "desc" } }))),
    staffTwoFactorStatus({ ...ctx, orgId: bureau.id, homeOrgId: undefined }),
    db.organization.findMany({ where: { bureauOrganizationId: bureau.id, engagement: { status: { not: "ENDED" } } }, select: { name: true, engagement: { select: { dpaReference: true, dpaSignedAt: true } } }, orderBy: { name: "asc" } }),
    db.launchCheck.findMany({ where: { bureauOrganizationId: bureau.id } }),
  ]);

  const staffResult: CheckResult = staff.missing === 0
    ? { status: "DONE", evidence: [`All ${staff.rows.length} active staff have two-factor on.`] }
    : { status: staff.inForce ? "TODO" : "ATTENTION", evidence: [`${staff.missing} of ${staff.rows.length} active staff haven't set up two-factor${staff.inForce ? " and are locked out until they do" : `; it becomes compulsory on ${staff.from ? iso(staff.from) : "its start day"}`}: ${staff.rows.filter((r) => !r.totpEnabled).map((r) => r.name).join(", ")}.`] };

  const lacking = clients.filter((c) => !c.engagement?.dpaReference || !c.engagement?.dpaSignedAt).map((c) => c.name);
  const termsResult: CheckResult = !clients.length
    ? { status: "DONE", evidence: ["No clients yet. Each client's data-processing terms are recorded when it is onboarded."] }
    : lacking.length
      ? { status: "TODO", evidence: [`No signed data-processing terms recorded for: ${lacking.join(", ")}. Record the reference and date on the client's page before its data goes in.`] }
      : { status: "DONE", evidence: [`All ${clients.length} client(s) have signed terms recorded.`] };

  const jobRows: JobRunRow[] = runs.filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ name: r.name, startedAt: r.startedAt, ok: r.ok, error: r.error }));
  const auto: ChecklistItem[] = [
    { key: "RULES", title: "The starting PAYE, pension and employer-contribution tables are verified by HR and Finance and published", ...rules, how: "Bureau → Statutory Rule Library: propose each table in force, have HR and Finance (two different people, neither the proposer) check it against the law and sign, then publish. Clients already holding the version are recorded as such.", points: RATE_POINTS, manual: false },
    { key: "EMAIL", title: "Email is really configured", ...checkEmail(env), how: "Set RESEND_API_KEY and EMAIL_FROM (an address on a domain you have verified with Resend). Use “Send me a test email” below to prove it.", manual: false },
    { key: "APP_URL", title: "The app's public address is set", ...checkAppUrl(env), how: "Set APP_URL to the https address clients will use.", manual: false },
    { key: "SECRETS", title: "The secrets are real", ...checkSecrets(env), how: "Generate long random values for AUTH_SECRET and CRON_SECRET; never reuse the example ones.", manual: false },
    { key: "AUDIT_SEAL", title: "The audit log is sealed against tampering", ...checkAuditSeal(env, jobRows, now), how: "Set AUDIT_SEAL_KEY (32+ random characters, kept off the database server and backed up separately: without it old seals cannot be checked) and call /api/cron/audit-seal every minute, /api/cron/audit-verify daily and /api/cron/audit-heads weekly. Keep the weekly chain-head emails.", manual: false },
    { key: "SCHEDULER", title: "A scheduler is calling the scheduled jobs", ...checkScheduler(jobRows, now), how: "Call each job's endpoint daily with “Authorization: Bearer <CRON_SECRET>”. docs/going-live.md has the lines for Vercel and for any server.", manual: false },
    { key: "STAFF_MFA", title: "Every member of staff has two-factor on", ...staffResult, how: "Each person turns it on under My security. A manager can bring the compulsory date forward on Bureau → Clients.", manual: false },
    { key: "CLIENT_TERMS", title: "Every client's signed data-processing terms are recorded", ...termsResult, manual: false },
  ];
  const byKey = new Map(confirmations.map((c) => [c.key, c]));
  const manual: ChecklistItem[] = MANUAL_CHECKS.map((m) => {
    const c = byKey.get(m.key);
    return { key: m.key, title: m.title, how: m.how, manual: true, status: c ? "DONE" : "TODO", evidence: c ? [`Confirmed by ${c.confirmedBy} on ${iso(c.confirmedAt)}: ${c.note}`] : ["Not confirmed yet."], confirmed: c ? { by: c.confirmedBy, at: c.confirmedAt, note: c.note } : undefined };
  });
  const items = [...auto, ...manual];
  return { bureau: bureau.name, items, ...summarise(items) };
}

/** How many items are still open, for a banner. */
export async function launchProgress(ctx: Ctx) {
  const c = await launchChecklist(ctx);
  return { done: c.done, total: c.total, ready: c.ready };
}

/** A bureau manager confirms something only a person can know, saying what they did. */
export async function confirmLaunchCheck(ctx: Ctx, key: string, note: string) {
  assertCan(ctx, "bureau.manage");
  const bureau = await bureauFor(ctx);
  if (!MANUAL_KEYS.includes(key)) throw new BusinessError("That item is checked by the app, not confirmed by hand.");
  const text = (note ?? "").trim();
  if (text.length < 10) throw new BusinessError("Say what you did and what you found (at least 10 characters), so the tick means something.");
  await db.launchCheck.upsert({
    where: { bureauOrganizationId_key: { bureauOrganizationId: bureau.id, key } },
    create: { bureauOrganizationId: bureau.id, key, note: text, confirmedBy: ctx.name, confirmedByUserId: ctx.userId },
    update: { note: text, confirmedBy: ctx.name, confirmedByUserId: ctx.userId, confirmedAt: new Date() },
  });
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "LAUNCH_CHECK_CONFIRM", entity: "LaunchCheck", entityId: key, newValue: { key }, reason: text });
}

/** Takes a confirmation back, for example after a bank changes its format. */
export async function withdrawLaunchCheck(ctx: Ctx, key: string, reason: string) {
  assertCan(ctx, "bureau.manage");
  const bureau = await bureauFor(ctx);
  if (!reason || reason.trim().length < 10) throw new BusinessError("Say why this is no longer confirmed (at least 10 characters).");
  const res = await db.launchCheck.deleteMany({ where: { bureauOrganizationId: bureau.id, key } });
  if (!res.count) throw new BusinessError("That item is not confirmed.");
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "LAUNCH_CHECK_WITHDRAW", entity: "LaunchCheck", entityId: key, newValue: { key }, reason });
}

/**
 * Sends the signed-in manager an email with a small PDF attached, to prove the provider accepts attachments (what payslip delivery depends
 * on). With no provider configured it is only written to the server log, and the result says so.
 */
export async function sendTestEmail(ctx: Ctx) {
  assertCan(ctx, "bureau.manage");
  const bureau = await bureauFor(ctx);
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("WorkforcePay test attachment", { x: 40, y: 130, size: 18, font });
  page.drawText(`Sent ${iso(new Date())} for ${bureau.name}. If you can open this, attachments work.`, { x: 40, y: 100, size: 10, font });
  const bytes = await doc.save();
  const live = !!process.env.RESEND_API_KEY;
  await sendEmail({
    to: ctx.email,
    subject: "WorkforcePay test email",
    text: "This is a test from the launch checklist. A small PDF is attached: if you can open it, payslip emails will arrive with their PDFs.",
    html: "<p>This is a test from the launch checklist.</p><p>A small PDF is attached: if you can open it, payslip emails will arrive with their PDFs.</p>",
    attachments: [{ filename: "test-attachment.pdf", content: Buffer.from(bytes) }],
  });
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "LAUNCH_TEST_EMAIL", entity: "LaunchCheck", entityId: "PAYSLIP_EMAIL", newValue: { to: ctx.email, live } });
  return { to: ctx.email, live };
}
