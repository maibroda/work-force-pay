import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { cancelSickSpell, decideSickSpell, listSickSpells, recordSickSpell, sickLeaveBalance } from "@/server/services/sick-leave";
import { updateLeavePolicy } from "@/server/services/leave";
import { isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, H14 piece 2 (docs/plans/hourly-payroll-h14-build-plan.md), step 2a: RECORDING a spell of sickness of a person paid by the hour, its approval by HR (never by the person who recorded it) and the days of
 * entitlement. No pay yet (the next step). The founder's answers of 2026-11-20 and 2026-11-21: paid sick leave, 5 days a year (the leave policy), a medical certificate, HR approves; the same leave year and service
 * period as annual leave. A spell holds only dates, working days and the certificate's id: never a diagnosis. Everything is invented. Calendar: 2043-06-01 is a Monday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function world() {
  const t = await isolatedOrg();
  const actor = async (role: Ctx["role"], n = 1, employeeId: string | null = null): Promise<Ctx> => {
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}${n}.${uid()}@sick.test`.toLowerCase(), name: `${role} ${n}`, role, passwordHash: "x", employeeId } });
    return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
  };
  const person = async (label: string, employmentDate = "2030-01-01", hourly = true) => {
    const e = await db.employee.create({ data: { organizationId: t.org.id, employeeNumber: `SK-${uid()}`, firstName: "Sk", lastName: `${label}${uid()}`, employmentDate: day(employmentDate), categoryId: t.guardId } });
    if (hourly) await db.employeeCompensationType.create({ data: { organizationId: t.org.id, employeeId: e.id, type: "HOURLY", effectiveFrom: day(employmentDate), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const medType = await db.employeeDocumentType.create({ data: { organizationId: t.org.id, category: "MEDICAL", code: "SICK_NOTE", name: "Sickness certificate", sensitive: true, standard: false } });
  const otherType = await db.employeeDocumentType.create({ data: { organizationId: t.org.id, category: "EMPLOYMENT", code: "CONTRACT", name: "Contract", standard: false } });
  const doc = (employeeId: string, kind: "medical" | "other" = "medical") => db.employeeDocument.create({ data: { organizationId: t.org.id, employeeId, documentType: kind === "medical" ? "MEDICAL_CERTIFICATE" : "EMPLOYMENT_CONTRACT", fileReference: `ref-${uid()}`, uploadedBy: "t", typeId: kind === "medical" ? medType.id : otherType.id } });
  const policy = (sickDaysPerYear: number) => db.leavePolicy.upsert({ where: { organizationId: t.org.id }, create: { organizationId: t.org.id, sickDaysPerYear }, update: { sickDaysPerYear } });
  return { t, actor, person, doc, policy };
}

describe("recording a spell of sickness", () => {
  it("is refused while paid sick leave is not set up (0 days a year, the default), and the leave policy can set the days", async () => {
    const w = await world();
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("Ada");
    const d = await w.doc(e.id);
    await expect(recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: d.id })).rejects.toThrow(/not set up/i);
    await updateLeavePolicy(hr, { annualDays: 10, eligibilityMonths: 12, workingDaysPerWeek: 5, sickDaysPerYear: 5 } as never);
    expect((await db.leavePolicy.findUniqueOrThrow({ where: { organizationId: w.t.org.id } })).sickDaysPerYear).toBe(5);
    await expect(updateLeavePolicy(hr, { annualDays: 10, eligibilityMonths: 12, workingDaysPerWeek: 5, sickDaysPerYear: -1 } as never)).rejects.toThrow();
    await expect(updateLeavePolicy(hr, { annualDays: 10, eligibilityMonths: 12, workingDaysPerWeek: 5, sickDaysPerYear: 61 } as never)).rejects.toThrow();
  });

  it("is kept as dates, working days, the leave year and the certificate's id, waiting for approval, and the audit entry holds ids and numbers only", async () => {
    const w = await world();
    await w.policy(5);
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("Bola");
    const d = await w.doc(e.id);
    const s = await recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-05", certificateDocumentId: d.id }); // Monday to Friday
    expect(s).toMatchObject({ status: "PENDING", workingDays: 5, certificateDocumentId: d.id, employeeId: e.id, organizationId: w.t.org.id, recordedByUserId: hr.userId });
    expect([s.cycleStart.toISOString().slice(0, 10), s.cycleEnd.toISOString().slice(0, 10)]).toEqual(["2043-01-01", "2043-12-31"]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "SICK_SPELL_RECORD", entityId: s.id } });
    const shown = JSON.stringify(audit.newValue);
    expect(shown).toContain(d.id); // the certificate by id
    expect(shown).not.toMatch(/diagnos|illness|symptom|reason|note/i); // never health details or free words
  });

  it("is refused for a person who is paid monthly, one who has not completed the service period, another company's person, and a spell with no working day", async () => {
    const w = await world();
    await w.policy(5);
    const hr = await w.actor("HR_ADMIN");
    const monthly = await w.person("Monthly", "2030-01-01", false);
    const newcomer = await w.person("Newcomer", "2043-03-01"); // 3 months in service on 2043-06-01
    const ok = await w.person("Ok");
    await expect(recordSickSpell(hr, { employeeId: monthly.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: (await w.doc(monthly.id)).id })).rejects.toThrow(/paid by the hour/i);
    await expect(recordSickSpell(hr, { employeeId: newcomer.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: (await w.doc(newcomer.id)).id })).rejects.toThrow(/after 12 months|falls due|not yet due/i);
    await expect(recordSickSpell(hr, { employeeId: ok.id, startDate: "2043-06-06", endDate: "2043-06-07", certificateDocumentId: (await w.doc(ok.id)).id })).rejects.toThrow(/no working days/i); // Saturday and Sunday
    await expect(recordSickSpell(hr, { employeeId: ok.id, startDate: "2043-06-03", endDate: "2043-06-02", certificateDocumentId: (await w.doc(ok.id)).id })).rejects.toThrow(/before/i);
    const other = await world();
    const otherHr = await other.actor("HR_ADMIN");
    await expect(recordSickSpell(otherHr, { employeeId: ok.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: (await w.doc(ok.id)).id })).rejects.toThrow(/not found/i);
  });

  it("needs the employee's own medical certificate: none, someone else's, or a document that is not a medical one are refused", async () => {
    const w = await world();
    await w.policy(5);
    const hr = await w.actor("HR_ADMIN");
    const a = await w.person("A");
    const b = await w.person("B");
    const span = { startDate: "2043-06-01", endDate: "2043-06-02" };
    await expect(recordSickSpell(hr, { employeeId: a.id, ...span, certificateDocumentId: "nope" })).rejects.toThrow(/certificate/i);
    await expect(recordSickSpell(hr, { employeeId: a.id, ...span, certificateDocumentId: (await w.doc(b.id)).id })).rejects.toThrow(/certificate/i); // B's
    await expect(recordSickSpell(hr, { employeeId: a.id, ...span, certificateDocumentId: (await w.doc(a.id, "other")).id })).rejects.toThrow(/medical/i);
  });

  it("is refused when it overlaps another spell that is waiting or approved (a rejected or cancelled one does not count), or lies in a closed pay period", async () => {
    const w = await world();
    await w.policy(5);
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("Overlap");
    const d = await w.doc(e.id);
    const first = await recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-02", endDate: "2043-06-03", certificateDocumentId: d.id });
    await expect(recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-03", endDate: "2043-06-04", certificateDocumentId: d.id })).rejects.toThrow(/overlap/i);
    await cancelSickSpell(hr, first.id);
    await expect(recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-03", endDate: "2043-06-04", certificateDocumentId: d.id })).resolves.toMatchObject({ status: "PENDING" });
    await db.payrollPeriod.create({ data: { organizationId: w.t.org.id, name: "July 2043", year: 2043, month: 7, startDate: day("2043-07-01"), endDate: day("2043-07-31"), status: "CLOSED" } });
    await expect(recordSickSpell(hr, { employeeId: e.id, startDate: "2043-07-06", endDate: "2043-07-07", certificateDocumentId: d.id })).rejects.toThrow(/closed/i);
  });

  it("a person can record their own, and no one else's (that needs HR)", async () => {
    const w = await world();
    await w.policy(5);
    const e = await w.person("Own");
    const f = await w.person("Other");
    const own = await w.actor("EMPLOYEE", 1, e.id);
    await expect(recordSickSpell(own, { startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: (await w.doc(e.id)).id })).resolves.toMatchObject({ employeeId: e.id, status: "PENDING" });
    await expect(recordSickSpell(own, { employeeId: f.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: (await w.doc(f.id)).id })).rejects.toThrow();
  });
});

describe("approving a spell of sickness", () => {
  it("is HR's, by someone other than the person who recorded it and other than the employee; a rejection needs a reason; a decision is final", async () => {
    const w = await world();
    await w.policy(5);
    const hr1 = await w.actor("HR_ADMIN", 1);
    const hr2 = await w.actor("HR_ADMIN", 2);
    const e = await w.person("Decide");
    const own = await w.actor("EMPLOYEE", 1, e.id);
    const d = await w.doc(e.id);
    const s = await recordSickSpell(hr1, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: d.id });
    await expect(decideSickSpell(hr1, s.id, "APPROVED")).rejects.toThrow(/recorded/i); // not by who recorded it
    await expect(decideSickSpell(own, s.id, "APPROVED")).rejects.toThrow(); // not the employee (no permission)
    await expect(decideSickSpell(hr2, s.id, "REJECTED", " ")).rejects.toThrow(/reason/i);
    const done = await decideSickSpell(hr2, s.id, "APPROVED");
    expect(done).toMatchObject({ status: "APPROVED", decidedByUserId: hr2.userId });
    await expect(decideSickSpell(hr2, s.id, "REJECTED", "Changed my mind")).rejects.toThrow(/already/i);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "SICK_SPELL_APPROVED", entityId: s.id } });
    expect(JSON.stringify(audit.newValue)).not.toMatch(/diagnos|illness|symptom/i);
  });

  it("a person who records their own spell cannot approve it, and a rejection keeps its reason on the spell only", async () => {
    const w = await world();
    await w.policy(5);
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("Self");
    const hrAsEmployee = await w.actor("HR_ADMIN", 3, e.id); // an HR user who is also this employee
    const s = await recordSickSpell(hrAsEmployee, { startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: (await w.doc(e.id)).id });
    await expect(decideSickSpell(hrAsEmployee, s.id, "APPROVED")).rejects.toThrow();
    const rejected = await decideSickSpell(hr, s.id, "REJECTED", "Certificate unreadable");
    expect(rejected).toMatchObject({ status: "REJECTED", decisionNote: "Certificate unreadable" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "SICK_SPELL_REJECTED", entityId: s.id } });
    expect(JSON.stringify(audit.newValue)).not.toContain("unreadable"); // the words stay on the spell, never in the audit log
  });

  it("another company cannot decide, cancel, list or count it", async () => {
    const w = await world();
    await w.policy(5);
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("Iso");
    const s = await recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: (await w.doc(e.id)).id });
    const other = await world();
    const otherHr = await other.actor("HR_ADMIN");
    await expect(decideSickSpell(otherHr, s.id, "APPROVED")).rejects.toThrow(/not found/i);
    await expect(cancelSickSpell(otherHr, s.id)).rejects.toThrow(/not found/i);
    expect(await listSickSpells(otherHr, {})).toHaveLength(0);
    await expect(sickLeaveBalance(otherHr, e.id, "2043-06-01")).rejects.toThrow(/not found/i);
  });
});

describe("cancelling, listing and the days of entitlement", () => {
  it("a spell can be cancelled while it waits, by whoever recorded it or by HR, and not once it is approved", async () => {
    const w = await world();
    await w.policy(5);
    const hr1 = await w.actor("HR_ADMIN", 1);
    const hr2 = await w.actor("HR_ADMIN", 2);
    const e = await w.person("Cancel");
    const d = await w.doc(e.id);
    const a = await recordSickSpell(hr1, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-01", certificateDocumentId: d.id });
    await expect(cancelSickSpell(hr1, a.id)).resolves.toMatchObject({ status: "CANCELLED" });
    const b = await recordSickSpell(hr1, { employeeId: e.id, startDate: "2043-06-02", endDate: "2043-06-02", certificateDocumentId: d.id });
    await decideSickSpell(hr2, b.id, "APPROVED");
    await expect(cancelSickSpell(hr1, b.id)).rejects.toThrow(/approved/i);
  });

  it("counts the days of the leave year (approved and waiting), and a spell beyond the entitlement is recorded, not refused", async () => {
    const w = await world();
    await w.policy(5);
    const hr1 = await w.actor("HR_ADMIN", 1);
    const hr2 = await w.actor("HR_ADMIN", 2);
    const e = await w.person("Days");
    const d = await w.doc(e.id);
    expect(await sickLeaveBalance(hr1, e.id, "2043-06-01")).toMatchObject({ due: true, entitled: 5, approved: 0, pending: 0, remaining: 5 });
    const s1 = await recordSickSpell(hr1, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-03", certificateDocumentId: d.id }); // 3 days
    await decideSickSpell(hr2, s1.id, "APPROVED");
    await recordSickSpell(hr1, { employeeId: e.id, startDate: "2043-06-08", endDate: "2043-06-14", certificateDocumentId: d.id }); // 5 working days: more than the 2 left
    expect(await sickLeaveBalance(hr1, e.id, "2043-06-01")).toMatchObject({ entitled: 5, approved: 3, pending: 5, remaining: 0 });
  });

  it("is visible to HR for everyone and to a person for their own only", async () => {
    const w = await world();
    await w.policy(5);
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("E1");
    const f = await w.person("E2");
    await recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-01", certificateDocumentId: (await w.doc(e.id)).id });
    await recordSickSpell(hr, { employeeId: f.id, startDate: "2043-06-01", endDate: "2043-06-01", certificateDocumentId: (await w.doc(f.id)).id });
    expect(await listSickSpells(hr, {})).toHaveLength(2);
    const own = await w.actor("EMPLOYEE", 1, e.id);
    const mine = await listSickSpells(own, {});
    expect(mine).toHaveLength(1);
    expect(mine[0].employeeId).toBe(e.id);
  });
});
