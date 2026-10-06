/**
 * Data subject access requests (the right to a copy of the personal data held on you — NDPA, GDPR).
 *
 * HR logs a request, checks the person's identity, then generates an export; the register tracks who asked,
 * the deadline (HR policy: days from receipt), who answered and a checksum of what was handed over. The
 * export is built on demand and never stored. Employees can also download their own data at any time.
 *
 * What goes in: everything held about the person, in plain language. What stays out is listed in the file:
 * interviewers' free-text feedback, confidential investigation records, other people's contact details,
 * and system logs.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import { dueDateFor, dueState, daysLeft, WITHHELD_NOTES } from "@/lib/data-requests";
import { num } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { outstandingKitValue } from "./inventory";
import { nextNumber } from "./numbering";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const dt = (v: Date | null | undefined) => (v ? iso(v) : null);
const money = (v: unknown) => (v === null || v === undefined ? null : num(v));
const words = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase() : null);

export interface DataSection {
  title: string;
  records: Array<Record<string, unknown>>;
}
export interface EmployeeDataExport {
  generatedOn: string;
  subject: { employeeNumber: string; name: string };
  note: string;
  withheld: readonly string[];
  sections: Record<string, DataSection>;
}

/**
 * Everything held about one employee, with no permission check — callers (HR, or the employee for
 * themselves) decide who may ask. Names and plain values, not internal ids.
 */
export async function compileEmployeeData(orgId: string, employeeId: string): Promise<EmployeeDataExport> {
  const e = await db.employee.findFirst({
    where: { id: employeeId, organizationId: orgId },
    include: { category: true, department: true, reportingManager: { select: { employeeNumber: true, firstName: true, lastName: true } } },
  });
  if (!e) throw new BusinessError("Employee not found.");
  const where = { organizationId: orgId, employeeId };

  const [contracts, exits, settlements, onboarding, deployments, movements, attendance, payslips, loans, leave, training, documents, discipline, cases, contacts, guarantors, appraisals, acks, letters, changes, candidate, kit] =
    await Promise.all([
      db.employmentContract.findMany({ where, orderBy: { startDate: "asc" } }),
      db.exitRecord.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.exitSettlement.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.onboardingTask.findMany({ where, orderBy: { sortOrder: "asc" } }),
      db.deployment.findMany({ where, include: { client: { select: { name: true } }, beat: { select: { name: true } } }, orderBy: { startDate: "asc" } }),
      db.staffMovement.findMany({ where, include: { fromClient: { select: { name: true } }, toClient: { select: { name: true } }, fromBeat: { select: { name: true } }, toBeat: { select: { name: true } } }, orderBy: { effectiveDate: "asc" } }),
      db.workRegister.aggregate({ where, _count: true, _min: { date: true }, _max: { date: true } }),
      db.payrollRecord.findMany({ where, include: { run: { select: { type: true, runNumber: true, period: { select: { name: true, year: true, month: true } } } } }, orderBy: [{ run: { period: { year: "asc" } } }, { run: { period: { month: "asc" } } }] }),
      db.staffLoan.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.leaveRequest.findMany({ where, orderBy: { startDate: "asc" } }),
      db.employeeTraining.findMany({ where, orderBy: { issueDate: "asc" } }),
      db.employeeDocument.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.disciplinaryRecord.findMany({ where: { ...where, status: "APPROVED" }, orderBy: { incidentDate: "asc" } }),
      db.relationsCase.findMany({ where, orderBy: { openedAt: "asc" } }),
      db.employeeContact.findMany({ where, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }),
      db.employeeGuarantor.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.appraisal.findMany({ where: { ...where, status: { in: ["APPROVED", "ACKNOWLEDGED"] } }, include: { cycle: true, ratings: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "asc" } }),
      db.policyAcknowledgement.findMany({ where, include: { version: { include: { policy: { select: { title: true } } } } }, orderBy: { acknowledgedAt: "asc" } }),
      db.generatedLetter.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.employeeChangeRequest.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.candidate.findFirst({ where: { organizationId: orgId, employeeId }, include: { interviews: { orderBy: { round: "asc" } }, offers: { orderBy: { createdAt: "asc" } } } }),
      outstandingKitValue(orgId, employeeId),
    ]);

  const confidential = cases.filter((c) => c.confidential).length;
  const sections: Record<string, DataSection> = {
    profile: {
      title: "Your personal and employment details",
      records: [
        {
          employeeNumber: e.employeeNumber,
          firstName: e.firstName,
          middleName: e.middleName,
          lastName: e.lastName,
          gender: words(e.gender),
          dateOfBirth: dt(e.dateOfBirth),
          phone: e.phone,
          email: e.email,
          address: e.address,
          employmentDate: dt(e.employmentDate),
          exitDate: dt(e.exitDate),
          status: words(e.status),
          category: e.category.name,
          department: e.department?.name ?? null,
          reportsTo: e.reportingManager ? `${e.reportingManager.employeeNumber} ${e.reportingManager.firstName} ${e.reportingManager.lastName}` : null,
          bankName: e.bankName,
          accountNumber: e.accountNumber,
          accountName: e.accountName,
          taxId: e.taxId,
          pensionPin: e.pensionPin,
          pfa: e.pfa,
          declaredAnnualRent: money(e.annualRent),
          recordCreated: dt(e.createdAt),
        },
      ],
    },
    contracts: {
      title: "Employment contracts",
      records: contracts.map((c) => ({ contractNumber: c.contractNumber, type: words(c.type), jobTitle: c.jobTitle, startDate: dt(c.startDate), endDate: dt(c.endDate), status: words(c.status), probationMonths: c.probationMonths, probationEnds: dt(c.probationEndDate), probationOutcome: words(c.probationOutcome), noticePeriodDays: c.noticePeriodDays, signed: dt(c.signedDate) })),
    },
    onboarding: { title: "Onboarding checklist", records: onboarding.map((t) => ({ step: t.taskName, status: words(t.status), completedOn: dt(t.completedAt), notes: t.notes })) },
    assignments: {
      title: "Where you have been posted",
      records: [
        ...deployments.map((x) => ({ kind: "posting", client: x.client.name, location: x.beat.name, shift: words(x.shift), from: dt(x.startDate), to: dt(x.endDate), status: words(x.status) })),
        ...movements.map((m) => ({ kind: "movement", type: words(m.movementType), from: [m.fromClient?.name, m.fromBeat?.name].filter(Boolean).join(" — ") || null, to: `${m.toClient.name} — ${m.toBeat.name}`, effective: dt(m.effectiveDate), status: words(m.status), reason: m.reason })),
      ],
    },
    attendance: {
      title: "Attendance records (summary — the day-by-day register is available on request)",
      records: attendance._count ? [{ daysRecorded: attendance._count, firstDay: dt(attendance._min.date), lastDay: dt(attendance._max.date) }] : [],
    },
    pay: {
      title: "Payslips",
      records: payslips.map((p) => ({
        period: p.run.period.name,
        run: p.run.type === "REGULAR" ? "regular" : `supplementary ${p.run.runNumber}`,
        daysWorked: num(p.daysWorked),
        overtimeHours: num(p.overtimeHours),
        monthlyGross: money(p.monthlyGross),
        totalEarnings: money(p.totalEarnings),
        paye: money(p.paye),
        employeePension: money(p.employeePension),
        otherDeductions: money(p.otherDeductions),
        netPay: money(p.netPay),
        bankAccountPaidTo: p.accountNumber,
      })),
    },
    loans: { title: "Staff loans and advances", records: loans.map((l) => ({ loanNumber: l.loanNumber, type: words(l.type), principal: money(l.principal), instalments: l.installmentCount, instalmentAmount: money(l.installmentAmount), status: words(l.status), paidOutOn: dt(l.disbursedOn), reason: l.reason, writtenOff: money(l.writtenOffAmount) })) },
    leave: { title: "Leave", records: leave.map((l) => ({ from: dt(l.startDate), to: dt(l.endDate), workingDays: l.workingDays, status: words(l.status), reason: l.reason })) },
    training: { title: "Training and certificates", records: training.map((t) => ({ course: t.courseName, provider: t.provider, certificateNumber: t.certificateNumber, issued: dt(t.issueDate), expires: dt(t.expiryDate), status: words(t.status) })) },
    documents: { title: "Documents on file (descriptions only — the files themselves are available on request)", records: documents.map((x) => ({ type: words(x.documentType), number: x.documentNumber, issued: dt(x.issueDate), expires: dt(x.expiryDate), reference: x.fileReference, notes: x.notes })) },
    conduct: {
      title: "Disciplinary records and employee-relations cases",
      records: [
        ...discipline.map((r) => ({ kind: "disciplinary record", type: words(r.type), incidentDate: dt(r.incidentDate), description: r.description, actionTaken: r.actionTaken, remarks: r.remarks })),
        ...cases.filter((c) => !c.confidential).map((c) => ({ kind: "case", caseNumber: c.caseNumber, type: words(c.type), opened: dt(c.openedAt), summary: c.summary, status: words(c.status), outcome: words(c.outcome), resolution: c.resolution })),
        ...(confidential ? [{ kind: "confidential case", note: `${confidential} confidential case(s) are held and withheld from this copy.` }] : []),
      ],
    },
    contacts: {
      title: "People you've told us about",
      records: [
        ...contacts.map((c) => ({ role: words(c.kind), name: c.fullName, relationship: c.relationship, phone: c.phone, email: c.email, address: c.address, dateOfBirth: dt(c.dateOfBirth), isMainContact: c.isPrimary, receivesBenefits: c.isBeneficiary, benefitSharePercent: c.benefitSharePct })),
        ...guarantors.map((g) => ({ role: "guarantor", name: g.fullName, relationship: g.relationship, status: words(g.status) })),
      ],
    },
    appraisals: {
      title: "Appraisals (once signed off)",
      records: appraisals.map((a) => ({
        review: a.cycle.name,
        period: `${iso(a.cycle.periodStart)} to ${iso(a.cycle.periodEnd)}`,
        score: a.overallScore ? num(a.overallScore) : null,
        rating: a.overallBand,
        recommendation: words(a.recommendation),
        strengths: a.strengths,
        areasToImprove: a.improvements,
        goals: a.goals,
        reviewerComment: a.reviewerComment,
        yourOwnComment: a.employeeSelfComment,
        yourResponse: a.acknowledgedAt ? (a.employeeAgreed ? "agreed" : "disagreed") : null,
        yourResponseComment: a.employeeResponse,
        criteria: a.ratings.map((r) => ({ criterion: r.criterionName, yourRating: r.selfRating, reviewerRating: r.rating, comment: r.comment })),
      })),
    },
    policies: { title: "Policies you have acknowledged", records: acks.map((a) => ({ policy: a.version.policy.title, version: a.version.version, acknowledgedOn: dt(a.acknowledgedAt), how: a.method === "RECORDED" ? "paper sign-off recorded by HR" : "by you" })) },
    letters: { title: "Letters issued to you", records: letters.map((l) => ({ reference: l.referenceNumber, type: words(l.type), subject: l.subject, issuedOn: dt(l.createdAt), text: l.body })) },
    changes: { title: "Requests to change your bank, tax or pension details", records: changes.map((c) => ({ details: words(c.kind), requestedOn: dt(c.createdAt), requestedBy: c.requestedBy, reason: c.reason, status: words(c.status), decidedBy: c.decidedBy, decidedOn: dt(c.decidedAt) })) },
    exits: {
      title: "Leaving the company",
      records: [
        ...exits.map((x) => ({ kind: "exit", type: words(x.exitType), noticeDate: dt(x.noticeDate), lastWorkingDay: dt(x.lastWorkingDate), reason: x.reason, status: words(x.status), exitInterviewNotes: x.exitInterviewNotes })),
        ...settlements.map((s) => ({ kind: "final settlement", number: s.settlementNumber, status: words(s.status), totalEarnings: money(s.grossEarnings), totalDeductions: money(s.totalDeductions), netSettlement: money(s.netSettlement) })),
      ],
    },
    uniformAndKit: { title: "Uniform and equipment issued to you and not yet returned", records: kit.rows.filter((r) => r.outstanding > 0).map((r) => ({ item: r.item.name, quantity: r.outstanding })) },
    recruitment: {
      title: "Your job application",
      records: candidate
        ? [
            {
              candidateNumber: candidate.candidateNumber,
              appliedOn: dt(candidate.createdAt),
              source: words(candidate.source),
              stage: words(candidate.stage),
              phone: candidate.phone,
              email: candidate.email,
              cvReference: candidate.resumeReference,
              interviews: candidate.interviews.map((i) => ({ round: i.round, date: dt(i.scheduledAt), mode: i.mode, score: i.score, recommendation: words(i.recommendation) })),
              offers: candidate.offers.map((o) => ({ offerNumber: o.offerNumber, jobTitle: o.jobTitle, monthlyGross: money(o.monthlyGross), status: words(o.status) })),
            },
          ]
        : [],
    },
  };

  return {
    generatedOn: iso(new Date()),
    subject: { employeeNumber: e.employeeNumber, name: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ") },
    note: "A copy of the personal data this company holds about you. Free-text items are shown as recorded. If anything is wrong or missing, tell HR.",
    withheld: WITHHELD_NOTES,
    sections,
  };
}

/** The file as bytes, a checksum of it, and how many records each section held. */
export function packageExport(data: EmployeeDataExport) {
  const text = JSON.stringify(data, null, 2);
  return {
    text,
    checksum: createHash("sha256").update(text).digest("hex"),
    sections: Object.fromEntries(Object.entries(data.sections).map(([k, s]) => [k, s.records.length])),
  };
}

// ───────────────────────────── The employee's own copy ─────────────────────────────

/** An employee downloads their own data. Needs nothing but being signed in as that employee. */
export async function exportMyData(ctx: Ctx) {
  if (!ctx.employeeId) throw new BusinessError("Your login isn't linked to an employee record, so there is no data held against it to export.");
  const data = await compileEmployeeData(ctx.orgId, ctx.employeeId);
  const pkg = packageExport(data);
  await logAudit(ctx, { action: "DATA_EXPORT_SELF", entity: "Employee", entityId: ctx.employeeId, newValue: { checksum: pkg.checksum, sections: pkg.sections } });
  return { ...pkg, data };
}

// ───────────────────────────── The request register ─────────────────────────────

export const requestSchema = z.object({
  employeeId: z.string().min(1, "Choose the employee"),
  requesterName: z.string().trim().min(2, "Who made the request?"),
  channel: opt,
  receivedOn: z.string().min(10, "When was it received?"),
});

export async function openRequest(ctx: Ctx, raw: z.input<typeof requestSchema>) {
  assertCan(ctx, "hr.manage");
  const v = requestSchema.parse(raw);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  const received = d(v.receivedOn);
  if (Number.isNaN(received.getTime())) throw new BusinessError("That date isn't valid.");
  if (received > todayUtc()) throw new BusinessError("A request can't have been received in the future.");
  const policy = await getHrPolicy(ctx.orgId);
  return db.$transaction(async (tx) => {
    const r = await tx.dataAccessRequest.create({
      data: {
        organizationId: ctx.orgId,
        requestNumber: await nextNumber(tx, ctx.orgId, "DATA_REQUEST"),
        employeeId: v.employeeId,
        requesterName: v.requesterName,
        channel: v.channel ?? null,
        receivedOn: received,
        dueOn: dueDateFor(received, policy.dsarResponseDays),
        createdBy: ctx.name,
      },
    });
    await logAudit(ctx, { action: "DSAR_OPEN", entity: "Employee", entityId: v.employeeId, newValue: { requestNumber: r.requestNumber, received: iso(received), due: iso(r.dueOn) } }, tx);
    return r;
  });
}

async function loadOpen(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const r = await db.dataAccessRequest.findFirst({ where: { id, organizationId: ctx.orgId }, include: { employee: true } });
  if (!r) throw new BusinessError("Request not found.");
  if (r.status !== "OPEN") throw new BusinessError(`This request is already ${r.status.toLowerCase()}.`);
  return r;
}

export async function verifyIdentity(ctx: Ctx, id: string, note: string) {
  const r = await loadOpen(ctx, id);
  if (!note || note.trim().length < 5) throw new BusinessError("Say how you checked who they are (e.g. shown their staff ID in person).");
  const u = await db.dataAccessRequest.update({ where: { id }, data: { identityVerified: true, identityNote: note.trim(), verifiedBy: ctx.name } });
  await logAudit(ctx, { action: "DSAR_VERIFY", entity: "Employee", entityId: r.employeeId, reason: note });
  return u;
}

/** HR generates the file for an open, identity-checked request. The file is returned, never stored. */
export async function exportForRequest(ctx: Ctx, id: string) {
  assertCan(ctx, "employee.sensitive"); // the export includes bank, tax and pension details
  const r = await loadOpen(ctx, id);
  if (!r.identityVerified) throw new BusinessError("Check and record the person's identity before generating their data.");
  const data = await compileEmployeeData(ctx.orgId, r.employeeId);
  const pkg = packageExport(data);
  await db.dataAccessRequest.update({ where: { id }, data: { exportedAt: new Date(), exportChecksum: pkg.checksum, exportSections: pkg.sections } });
  await logAudit(ctx, { action: "DSAR_EXPORT", entity: "Employee", entityId: r.employeeId, newValue: { requestNumber: r.requestNumber, checksum: pkg.checksum, sections: pkg.sections } });
  return { ...pkg, data, requestNumber: r.requestNumber };
}

export async function completeRequest(ctx: Ctx, id: string, note?: string) {
  const r = await loadOpen(ctx, id);
  if (!r.exportedAt) throw new BusinessError("Generate the export first — a request is complete once the person has been given their data.");
  const u = await db.dataAccessRequest.update({ where: { id }, data: { status: "FULFILLED", handledBy: ctx.name, completedOn: todayUtc(), completionNote: note?.trim() || null } });
  await logAudit(ctx, { action: "DSAR_COMPLETE", entity: "Employee", entityId: r.employeeId, newValue: { requestNumber: r.requestNumber, onTime: todayUtc() <= r.dueOn }, reason: note });
  return u;
}

export async function refuseRequest(ctx: Ctx, id: string, reason: string) {
  const r = await loadOpen(ctx, id);
  if (!reason || reason.trim().length < 10) throw new BusinessError("Give the reason in a sentence — the person is entitled to be told why, and to complain.");
  const u = await db.dataAccessRequest.update({ where: { id }, data: { status: "REFUSED", handledBy: ctx.name, completedOn: todayUtc(), refusalReason: reason.trim() } });
  await logAudit(ctx, { action: "DSAR_REFUSE", entity: "Employee", entityId: r.employeeId, newValue: { requestNumber: r.requestNumber }, reason });
  return u;
}

export async function listRequests(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const today = todayUtc();
  const rows = await db.dataAccessRequest.findMany({
    where: { organizationId: ctx.orgId },
    include: { employee: { select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, status: true } } },
    orderBy: [{ status: "asc" }, { dueOn: "asc" }],
  });
  return rows.map((r) => ({ ...r, state: dueState(r.status, r.dueOn, today), daysLeft: daysLeft(r.dueOn, today), canExport: can(ctx.role, "employee.sensitive") }));
}

/** Open requests that are overdue or nearly so, for the HR digest (no permission check — it runs as the system). */
export async function requestsNeedingAttention(orgId: string, today: Date) {
  const open = await db.dataAccessRequest.findMany({ where: { organizationId: orgId, status: "OPEN" }, include: { employee: true }, orderBy: { dueOn: "asc" } });
  return open.map((r) => ({ ...r, state: dueState(r.status, r.dueOn, today), daysLeft: daysLeft(r.dueOn, today) })).filter((r) => r.state === "OVERDUE" || r.state === "DUE_SOON");
}
