/**
 * Row builders for the HR reports in the Reports hub. Each one goes through the service that already
 * guards that data, so a report can never show more than the same person could see on screen.
 */
import type { Ctx } from "@/lib/auth/context";
import { FIELD_LABELS, KIND_FIELDS, KIND_LABELS, normalizeValue } from "@/lib/change-control";
import { fmtDate } from "@/lib/dates";
import { ACK_LABELS } from "@/lib/policies";
import { ageOn, CONTACT_LABELS } from "@/lib/personal-records";
import { STATE_LABELS } from "@/lib/training-compliance";
import { RECOMMENDATION_LABELS, KIND_LABELS as APPRAISAL_KINDS } from "@/lib/appraisal";
import { num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { assertCan, db } from "./_base";
import { listChanges } from "./change-requests";
import { listGuarantors, recordsOverview } from "./personal-records";
import { appraisalResults } from "./appraisals";
import { todayUtc } from "./hr-policy";
import { complianceOverview } from "./training";
import { listPolicies } from "./policies";

type Row = Record<string, unknown>;
const GONE = ["EXITED", "TERMINATED", "RESIGNED"] as const;
const yn = (b: boolean | null | undefined) => (b === null || b === undefined ? "" : b ? "Yes" : "No");
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();

/** Every current employee with the facts HR is usually asked for: who, where, since when, on what terms. */
export async function employeeRegister(ctx: Ctx): Promise<Row[]> {
  assertCan(ctx, "hr.view");
  const today = todayUtc();
  const emps = await db.employee.findMany({
    where: { organizationId: ctx.orgId, status: { notIn: [...GONE] } },
    include: { category: true, department: true, employmentContracts: { where: { status: "ACTIVE" }, orderBy: { startDate: "desc" }, take: 1 } },
    orderBy: { employeeNumber: "asc" },
  });
  return emps.map((e) => {
    const c = e.employmentContracts[0];
    return {
      employeeNumber: e.employeeNumber,
      employeeName: fullName(e),
      category: e.category.name,
      department: e.department?.name ?? "",
      status: label(e.status),
      gender: e.gender ? label(e.gender) : "",
      age: e.dateOfBirth ? ageOn(e.dateOfBirth, today) : "",
      employmentDate: fmtDate(e.employmentDate),
      serviceYears: Math.round(((today.getTime() - e.employmentDate.getTime()) / (365.25 * 86_400_000)) * 10) / 10,
      contractType: c ? label(c.type) : "no contract on file",
      contractEnds: c?.endDate ? fmtDate(c.endDate) : c ? "open-ended" : "",
      probation: c?.probationOutcome ? label(c.probationOutcome) : "",
    };
  });
}

const STATE_ORDER: Record<string, number> = { EXPIRED: 0, MISSING: 1, EXPIRING: 2, GRACE: 3, VALID: 4 };

export async function trainingComplianceRows(ctx: Ctx): Promise<Row[]> {
  const { rows } = await complianceOverview(ctx);
  return rows
    .flatMap((r) => r.items.map((i) => ({ r, i })))
    .sort((a, b) => STATE_ORDER[a.i.assessment.state] - STATE_ORDER[b.i.assessment.state] || a.r.employee.employeeNumber.localeCompare(b.r.employee.employeeNumber))
    .map(({ r, i }) => ({
      employeeNumber: r.employee.employeeNumber,
      employeeName: fullName(r.employee),
      category: r.employee.category.name,
      requirement: i.requirement.courseName,
      status: STATE_LABELS[i.assessment.state],
      validUntil: i.assessment.expiryDate ? fmtDate(i.assessment.expiryDate) : i.assessment.state === "VALID" ? "No expiry" : "",
      daysLeft: i.assessment.daysLeft ?? "",
    }));
}

const ACK_ORDER = { OVERDUE: 0, PENDING: 1, ACKNOWLEDGED: 2 } as const;

export async function policyAcknowledgementRows(ctx: Ctx): Promise<Row[]> {
  const { active } = await listPolicies(ctx);
  return active.flatMap((c) =>
    [...c.rows]
      .sort((a, b) => ACK_ORDER[a.state] - ACK_ORDER[b.state] || a.employee.employeeNumber.localeCompare(b.employee.employeeNumber))
      .map((r) => ({
        policy: c.policy.title,
        version: c.current ? `v${c.current.version}` : "",
        employeeNumber: r.employee.employeeNumber,
        employeeName: fullName(r.employee),
        category: r.employee.category.name,
        status: ACK_LABELS[r.state],
        due: fmtDate(r.due),
        acknowledgedOn: r.acknowledgedAt ? fmtDate(r.acknowledgedAt) : "",
        how: r.method === "RECORDED" ? "Paper sign-off" : r.method === "SELF" ? "By the employee" : "",
        reference: r.note ?? "",
      })),
  );
}

export async function appraisalResultRows(ctx: Ctx, cycleId?: string): Promise<Row[]> {
  const rows = await appraisalResults(ctx, { cycleId });
  return rows.map((a) => {
    const released = a.status === "APPROVED" || a.status === "ACKNOWLEDGED"; // a score isn't shown until it's been signed off
    return {
      cycle: a.cycle.name,
      type: APPRAISAL_KINDS[a.cycle.kind],
      employeeNumber: a.employee.employeeNumber,
      employeeName: fullName(a.employee),
      category: a.employee.category.name,
      reviewer: a.reviewerName ?? "",
      status: label(a.status),
      score: released && a.overallScore != null ? num(a.overallScore) : "",
      band: released ? (a.overallBand ?? "") : "",
      recommendation: released ? RECOMMENDATION_LABELS[a.recommendation] : "",
      signedOffBy: a.approvedBy ?? "",
      employeeResponse: a.status === "ACKNOWLEDGED" ? (a.employeeAgreed ? "Agreed" : "Disagreed") : "",
    };
  });
}

export async function guarantorRows(ctx: Ctx): Promise<Row[]> {
  const all = await listGuarantors(ctx);
  return all.map((g) => ({
    employeeNumber: g.employee.employeeNumber,
    employeeName: fullName(g.employee),
    guarantor: g.fullName,
    relationship: g.relationship,
    phone: g.phone,
    address: g.address,
    idType: g.idType ? label(g.idType) : "",
    idNumber: g.idNumber ?? "",
    formReference: g.formReference ?? "",
    guaranteeAmount: g.guaranteeAmount ? num(g.guaranteeAmount) : "",
    status: label(g.status),
    recordedBy: g.recordedBy,
    verifiedBy: g.verifiedBy ?? "",
    verifiedOn: g.verifiedAt ? fmtDate(g.verifiedAt) : "",
  }));
}

export async function recordsCompletenessRows(ctx: Ctx): Promise<Row[]> {
  const { rows } = await recordsOverview(ctx);
  return rows
    .map((r) => ({ r, order: r.gaps.complete ? 1 : 0 }))
    .sort((a, b) => a.order - b.order || a.r.employee.employeeNumber.localeCompare(b.r.employee.employeeNumber))
    .map(({ r }) => ({
      employeeNumber: r.employee.employeeNumber,
      employeeName: fullName(r.employee),
      category: r.employee.category.name,
      nextOfKin: r.contacts.filter((c) => c.kind === "NEXT_OF_KIN").length,
      emergencyContacts: r.contacts.filter((c) => c.kind === "EMERGENCY_CONTACT").length,
      dependants: r.contacts.filter((c) => c.kind === "DEPENDANT").length,
      guarantorsNeeded: r.gaps.guarantorsNeeded,
      guarantorsVerified: r.gaps.guarantorsVerified,
      guarantorsPending: r.gaps.guarantorsPending,
      beneficiaryShare: r.shares.count ? `${r.shares.total}%` : "",
      complete: yn(r.gaps.complete),
      missing: [
        r.gaps.nextOfKinMissing ? `${r.gaps.nextOfKinMissing} ${CONTACT_LABELS.NEXT_OF_KIN.toLowerCase()}` : "",
        r.gaps.emergencyMissing ? `${r.gaps.emergencyMissing} ${CONTACT_LABELS.EMERGENCY_CONTACT.toLowerCase()}` : "",
        r.gaps.guarantorsMissing ? `${r.gaps.guarantorsMissing} verified guarantor(s)` : "",
      ]
        .filter(Boolean)
        .join("; "),
    }));
}

/**
 * The log of requests to change bank, tax and pension details. It deliberately names *which fields*
 * changed but never their values — an export of account numbers is the thing change control exists to avoid.
 */
export async function detailChangeRows(ctx: Ctx): Promise<Row[]> {
  const all = await listChanges(ctx);
  return all.map((r) => {
    const prev = r.previous as Record<string, unknown>;
    const next = r.proposed as Record<string, unknown>;
    const fields = KIND_FIELDS[r.kind].filter((f) => String(normalizeValue(prev[f]) ?? "") !== String(normalizeValue(next[f]) ?? ""));
    return {
      requestedOn: fmtDate(r.createdAt),
      employeeNumber: r.employee.employeeNumber,
      employeeName: fullName(r.employee),
      kind: KIND_LABELS[r.kind],
      fieldsChanged: fields.map((f) => FIELD_LABELS[f]).join(", "),
      reason: r.reason,
      requestedBy: r.requestedBy,
      status: label(r.status),
      decidedBy: r.decidedBy ?? "",
      decidedOn: r.decidedAt ? fmtDate(r.decidedAt) : "",
      decisionNote: r.decisionNote ?? "",
      accountNameMatched: r.nameMatches === null ? "" : yn(r.nameMatches),
    };
  });
}
