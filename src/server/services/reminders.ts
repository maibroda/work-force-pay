/**
 * HR reminder digest — one email a day listing what needs a person's attention: approvals waiting,
 * contracts ending, probation reviews, overdue onboarding steps, employee-relations deadlines, and
 * leavers who still hold kit or owe a loan. It reads the same data as the HR overview, so the email
 * and the dashboard never disagree.
 *
 * It goes to every active HR admin plus any extra addresses in the HR policy, at most once a day,
 * and never when there is nothing to report. Meant to be called by a scheduler hitting
 * /api/cron/hr-digest; HR can also send one on demand.
 */
import type { Ctx } from "@/lib/auth/context";
import { addDays, fmtDate, iso } from "@/lib/dates";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { assertCan, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { kitHeldByLeavers } from "./inventory";
import { loansOwedByLeavers } from "./loans";
import { recordsOverviewFor } from "./personal-records";
import { appraisalAttention } from "./appraisals";

const OPEN_CASE = ["OPEN", "INVESTIGATING", "HEARING"];
const SHOWN = 10;
/** A new joiner isn't chased about their personal records until they've been here this long. */
const RECORDS_GRACE_DAYS = 30;

export interface DigestItem {
  text: string;
  path: string;
}
export interface DigestSection {
  key: string;
  title: string;
  /** Total in this section, which can be more than the items listed. */
  count: number;
  items: DigestItem[];
}

const name = (e: { employeeNumber: string; firstName: string; lastName: string }) => `${e.employeeNumber} ${fullName(e)}`;

function section(key: string, title: string, items: DigestItem[]): DigestSection {
  return { key, title, count: items.length, items: items.slice(0, SHOWN) };
}

/** Everything that needs doing, as of `today`. Sections with nothing in them are left out. */
export async function buildHrDigest(orgId: string, today = todayUtc()) {
  const policy = await getHrPolicy(orgId);
  const contractHorizon = addDays(today, policy.contractAlertDays);
  const probationHorizon = addDays(today, policy.probationAlertDays);
  const caseHorizon = addDays(today, 3);
  const [org, reqs, offers, exits, discipline, settlements, loans, awaitingRelease, ending, probation, noContract, onboarding, cases, kit, owed, docs, records, appraisals] =
    await Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
      db.jobRequisition.findMany({ where: { organizationId: orgId, status: "PENDING_APPROVAL" }, orderBy: { createdAt: "asc" } }),
      db.jobOffer.findMany({ where: { organizationId: orgId, status: "PENDING_APPROVAL" }, include: { candidate: true }, orderBy: { createdAt: "asc" } }),
      db.exitRecord.findMany({ where: { organizationId: orgId, status: "PENDING" }, include: { employee: true }, orderBy: { createdAt: "asc" } }),
      db.disciplinaryRecord.findMany({ where: { organizationId: orgId, status: "PENDING" }, include: { employee: true }, orderBy: { createdAt: "asc" } }),
      db.exitSettlement.findMany({ where: { organizationId: orgId, status: "PENDING_APPROVAL" }, include: { employee: true }, orderBy: { createdAt: "asc" } }),
      db.staffLoan.findMany({ where: { organizationId: orgId, status: "PENDING_APPROVAL" }, include: { employee: true }, orderBy: { createdAt: "asc" } }),
      db.exitSettlement.findMany({ where: { organizationId: orgId, status: "APPROVED" }, include: { employee: true }, orderBy: { createdAt: "asc" } }),
      db.employmentContract.findMany({ where: { organizationId: orgId, status: "ACTIVE", endDate: { not: null, lte: contractHorizon } }, include: { employee: true }, orderBy: { endDate: "asc" } }),
      db.employmentContract.findMany({
        where: { organizationId: orgId, status: "ACTIVE", probationOutcome: { in: ["PENDING", "EXTENDED"] }, probationEndDate: { not: null, lte: probationHorizon } },
        include: { employee: true },
        orderBy: { probationEndDate: "asc" },
      }),
      db.employee.count({ where: { organizationId: orgId, status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] }, employmentContracts: { none: { status: "ACTIVE" } } } }),
      db.onboardingTask.findMany({
        where: { organizationId: orgId, status: "PENDING", mandatory: true, dueDate: { lt: today } },
        include: { employee: true },
        orderBy: { dueDate: "asc" },
      }),
      db.relationsCase.findMany({ where: { organizationId: orgId, status: { in: OPEN_CASE as never }, dueDate: { lte: caseHorizon } }, include: { employee: true }, orderBy: { dueDate: "asc" } }),
      kitHeldByLeavers(orgId),
      loansOwedByLeavers(orgId),
      db.employeeDocument.findMany({ where: { organizationId: orgId, expiryDate: { not: null, lte: addDays(today, 30) } }, include: { employee: true }, orderBy: { expiryDate: "asc" } }),
      recordsOverviewFor(orgId),
      appraisalAttention(orgId, today),
    ]);

  const sections: DigestSection[] = [];
  const add = (s: DigestSection) => s.count && sections.push(s);

  add(
    section("approvals", "Waiting for your approval", [
      ...reqs.map((r) => ({ text: `Job requisition ${r.requisitionNumber} — ${r.title} (raised by ${r.requestedBy})`, path: `/hr/requisitions/${r.id}` })),
      ...offers.map((o) => ({ text: `Job offer ${o.offerNumber} — ${o.candidate.firstName} ${o.candidate.lastName}, ${o.jobTitle}`, path: `/hr/candidates/${o.candidateId}` })),
      ...exits.map((x) => ({ text: `Exit — ${name(x.employee)} (${x.exitType.replace(/_/g, " ").toLowerCase()}, last day ${fmtDate(x.lastWorkingDate)})`, path: `/hr/exits/${x.id}` })),
      ...discipline.map((x) => ({ text: `Disciplinary record — ${name(x.employee)} (${x.type.replace(/_/g, " ").toLowerCase()})`, path: `/employees/${x.employeeId}?tab=conduct` })),
      ...settlements.map((s) => ({ text: `End-of-service settlement ${s.settlementNumber} — ${name(s.employee)}, net ${naira(s.netSettlement)}`, path: `/payroll/settlements/${s.id}` })),
      ...appraisals.awaiting.map((a) => ({ text: `Appraisal — ${name(a.employee)} (${a.cycle.name}), reviewed by ${a.reviewerName ?? "—"}`, path: `/hr/appraisals/${a.id}` })),
      ...loans.map((l) => ({ text: `${l.type === "SALARY_ADVANCE" ? "Salary advance" : "Staff loan"} ${l.loanNumber} — ${name(l.employee)}, ${naira(l.principal)}`, path: `/payroll/loans/${l.id}` })),
    ]),
  );
  add(
    section(
      "settlements",
      "Approved settlements not yet released into payroll",
      awaitingRelease.map((s) => ({ text: `${s.settlementNumber} — ${name(s.employee)}, net ${naira(s.netSettlement)}`, path: `/payroll/settlements/${s.id}` })),
    ),
  );
  add(
    section(
      "contracts",
      "Contracts ending",
      ending.map((c) => ({
        text: `${c.contractNumber} — ${name(c.employee)}: ${c.endDate! < today ? "ended" : "ends"} ${fmtDate(c.endDate)}${c.endDate! < today ? " (past)" : ""}`,
        path: `/hr/contracts/${c.id}`,
      })),
    ),
  );
  add(
    section(
      "probation",
      "Probation reviews",
      probation.map((c) => ({
        text: `${name(c.employee)}: probation ${c.probationEndDate! < today ? "ended" : "ends"} ${fmtDate(c.probationEndDate)}${c.probationEndDate! < today ? " — overdue" : ""}`,
        path: `/hr/contracts/${c.id}`,
      })),
    ),
  );
  if (noContract)
    sections.push({ key: "no-contract", title: "Staff with no contract on file", count: noContract, items: [{ text: `${noContract} active employee(s) have no employment contract recorded`, path: "/hr/contracts?tab=alerts" }] });

  const overdueByEmployee = new Map<string, { employee: (typeof onboarding)[number]["employee"]; steps: number }>();
  for (const t of onboarding) overdueByEmployee.set(t.employeeId, { employee: t.employee, steps: (overdueByEmployee.get(t.employeeId)?.steps ?? 0) + 1 });
  add(
    section(
      "onboarding",
      "Overdue onboarding steps",
      [...overdueByEmployee.values()].map((e) => ({ text: `${name(e.employee)} — ${e.steps} overdue step(s)`, path: `/employees/${e.employee.id}?tab=lifecycle` })),
    ),
  );
  add(
    section(
      "relations",
      "Employee-relations deadlines",
      cases.map((c) => ({
        text: `${c.caseNumber} — ${c.confidential ? "Confidential case" : c.summary}: ${c.dueDate! < today ? "past its target" : "target"} ${fmtDate(c.dueDate)}`,
        path: `/hr/relations/${c.id}`,
      })),
    ),
  );
  add(
    section(
      "appraisals",
      "Overdue appraisal reviews",
      appraisals.overdue.map((a) => ({
        text: `${name(a.employee)} — ${a.cycle.name}, was due ${fmtDate(a.cycle.dueDate)}${a.reviewerName ? ` (reviewer ${a.reviewerName})` : " — no reviewer assigned"}`,
        path: `/hr/appraisals/${a.id}`,
      })),
    ),
  );
  const pastGrace = records.rows.filter((r) => r.employee.employmentDate <= addDays(today, -RECORDS_GRACE_DAYS));
  add(
    section(
      "guarantors",
      "Guarantors waiting to be verified",
      records.rows.flatMap((r) =>
        r.guarantors.filter((g) => g.status === "PENDING").map((g) => ({ text: `${g.fullName} for ${name(r.employee)} — recorded ${fmtDate(g.createdAt)}`, path: `/employees/${r.employee.id}?tab=contacts` })),
      ),
    ),
  );
  const noKin = pastGrace.filter((r) => r.gaps.nextOfKinMissing > 0).length;
  const noEmergency = pastGrace.filter((r) => r.gaps.emergencyMissing > 0).length;
  const shortGuarantors = pastGrace.filter((r) => r.gaps.guarantorsMissing > 0).length;
  const incomplete = pastGrace.filter((r) => !r.gaps.complete).length;
  if (incomplete)
    sections.push({
      key: "records",
      title: "Incomplete personal records",
      count: incomplete,
      items: [
        noKin ? { text: `${noKin} employee(s) have no next of kin on file`, path: "/employees/next-of-kin" } : null,
        noEmergency ? { text: `${noEmergency} employee(s) have no emergency contact`, path: "/employees/next-of-kin" } : null,
        shortGuarantors ? { text: `${shortGuarantors} employee(s) are short of verified guarantors`, path: "/employees/guarantors" } : null,
      ].filter((x): x is DigestItem => x !== null),
    });
  add(section("kit", "Leavers still holding uniform & kit", kit.map((k) => ({ text: `${name(k.employee)} — ${k.items} item(s), ${naira(k.value)}`, path: `/employees/${k.employee.id}?tab=kit` }))));
  add(section("loans", "Leavers who still owe a staff loan", owed.map((l) => ({ text: `${name(l.employee)} — ${naira(l.outstanding)} across ${l.loans} loan(s)`, path: `/payroll/loans?q=${l.employee.employeeNumber}` }))));
  add(
    section(
      "documents",
      "Documents expired or expiring within 30 days",
      docs.map((x) => ({
        text: `${name(x.employee)} — ${x.documentType.replace(/_/g, " ").toLowerCase()} ${x.expiryDate! < today ? "expired" : "expires"} ${fmtDate(x.expiryDate)}`,
        path: `/employees/${x.employeeId}?tab=documents`,
      })),
    ),
  );

  return { orgName: org.name, date: iso(today), sections, total: sections.reduce((s, x) => s + x.count, 0) };
}

export type HrDigest = Awaited<ReturnType<typeof buildHrDigest>>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderDigest(digest: HrDigest, appUrl = process.env.APP_URL ?? "http://localhost:3000") {
  const base = appUrl.replace(/\/$/, "");
  const subject = `${digest.orgName} HR digest — ${digest.total} item(s) need attention (${digest.date})`;
  const text = [
    `HR digest for ${digest.orgName} — ${digest.date}`,
    "",
    ...digest.sections.flatMap((s) => [
      `${s.title.toUpperCase()} (${s.count})`,
      ...s.items.map((i) => `  • ${i.text}\n    ${base}${i.path}`),
      ...(s.count > s.items.length ? [`  …and ${s.count - s.items.length} more`] : []),
      "",
    ]),
    `Open the HR overview: ${base}/hr`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px"><h2 style="margin:0 0 4px">HR digest</h2><p style="color:#555;margin:0 0 16px">${esc(digest.orgName)} — ${digest.date}</p>${digest.sections
    .map(
      (s) =>
        `<h3 style="margin:18px 0 6px;font-size:15px">${esc(s.title)} <span style="color:#888;font-weight:normal">(${s.count})</span></h3><ul style="margin:0;padding-left:18px">${s.items
          .map((i) => `<li style="margin:3px 0"><a href="${esc(base + i.path)}">${esc(i.text)}</a></li>`)
          .join("")}${s.count > s.items.length ? `<li style="color:#888">…and ${s.count - s.items.length} more</li>` : ""}</ul>`,
    )
    .join("")}<p style="margin-top:20px"><a href="${esc(base)}/hr">Open the HR overview</a></p></div>`;
  return { subject, text, html };
}

export interface DigestResult {
  organization: string;
  sent: number;
  total: number;
  recipients: string[];
  failed: string[];
  skipped?: string;
}

/** Sends the digest for one organization — at most once a UTC day unless `force`, and never an empty one. */
export async function sendHrDigest(orgId: string, opts: { force?: boolean; now?: Date } = {}): Promise<DigestResult> {
  const now = opts.now ?? new Date();
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const policy = await getHrPolicy(orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
  const result: DigestResult = { organization: org.name, sent: 0, total: 0, recipients: [], failed: [] };
  const skip = (reason: string) => ({ ...result, skipped: reason });

  if (!policy.reminderEmailsEnabled && !opts.force) return skip("Reminder emails are switched off in the HR policy.");
  if (!opts.force && policy.lastDigestAt && iso(policy.lastDigestAt) === iso(today)) return skip("A digest was already sent today.");

  const admins = await db.user.findMany({ where: { organizationId: orgId, role: "HR_ADMIN", active: true }, select: { email: true } });
  const recipients = [...new Set([...admins.map((a) => a.email), ...policy.reminderExtraEmails].map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return skip("There is nobody to send it to — no active HR admin and no extra addresses.");

  const digest = await buildHrDigest(orgId, today);
  result.total = digest.total;
  if (!digest.total) return skip("Nothing needs attention today.");

  const mail = renderDigest(digest);
  for (const to of recipients) {
    try {
      await sendEmail({ to, ...mail });
      result.sent++;
      result.recipients.push(to);
    } catch (e) {
      logger.error("hr_digest_send_failed", { to, error: e });
      result.failed.push(to);
    }
  }
  if (result.sent) {
    await db.hrPolicy.update({ where: { organizationId: orgId }, data: { lastDigestAt: now } });
    await db.auditLog.create({
      data: {
        organizationId: orgId,
        userName: "System (HR digest)",
        action: "HR_DIGEST_SENT",
        entity: "HrPolicy",
        newValue: { items: digest.total, recipients: result.recipients.length, failed: result.failed.length },
        metadata: { forced: Boolean(opts.force) },
      },
    });
  }
  return result;
}

/** The scheduled job: every organization, in turn. One organization failing never stops the rest. */
export async function runDigestForAllOrgs(now = new Date()): Promise<DigestResult[]> {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  const out: DigestResult[] = [];
  for (const o of orgs) {
    try {
      out.push(await sendHrDigest(o.id, { now }));
    } catch (e) {
      logger.error("hr_digest_org_failed", { organization: o.name, error: e });
      out.push({ organization: o.name, sent: 0, total: 0, recipients: [], failed: [], skipped: "Failed — see the server log." });
    }
  }
  return out;
}

/** HR sending one on demand — ignores the once-a-day rule, still never sends an empty one. */
export async function sendHrDigestNow(ctx: Ctx) {
  assertCan(ctx, "hr.manage");
  const r = await sendHrDigest(ctx.orgId, { force: true });
  await logAudit(ctx, { action: "HR_DIGEST_SEND_NOW", entity: "HrPolicy", newValue: r });
  return r;
}

/** What the digest would say right now — for the on-screen preview. */
export async function previewHrDigest(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const policy = await getHrPolicy(ctx.orgId);
  const digest = await buildHrDigest(ctx.orgId);
  const admins = await db.user.count({ where: { organizationId: ctx.orgId, role: "HR_ADMIN", active: true } });
  return { digest, lastSentAt: policy.lastDigestAt, enabled: policy.reminderEmailsEnabled, recipientCount: admins + policy.reminderExtraEmails.length };
}
