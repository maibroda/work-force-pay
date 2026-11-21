import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { listMedicalCertificates, listSickSpells, mySickLeave, recordSickSpell, recordSickSpellFromCertificate } from "@/server/services/sick-leave";
import { isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, H14 piece 2, step 2c (docs/plans/hourly-payroll-h14-build-plan.md): what the SCREENS for paid sick leave need from the service. A person sees and records their own spells on My leave; HR sees every spell,
 * chooses the certificate (which says whose spell it is), approves and rejects on Leave management. Nobody else sees any of it. The screens themselves only call these functions and the ones of step 2a. Everything is invented.
 * Calendar: 2043-06-01 is a Monday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function world(sickDaysPerYear = 5) {
  const t = await isolatedOrg();
  await db.leavePolicy.upsert({ where: { organizationId: t.org.id }, create: { organizationId: t.org.id, sickDaysPerYear }, update: { sickDaysPerYear } });
  const actor = async (role: Ctx["role"], n = 1, employeeId: string | null = null): Promise<Ctx> => {
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}${n}.${uid()}@scr.test`.toLowerCase(), name: `${role} ${n}`, role, passwordHash: "x", employeeId } });
    return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
  };
  const person = async (label: string, hourly = true) => {
    const e = await db.employee.create({ data: { organizationId: t.org.id, employeeNumber: `SC-${uid()}`, firstName: "Sc", lastName: `${label}${uid()}`, employmentDate: day("2020-01-01"), categoryId: t.guardId } });
    if (hourly) await db.employeeCompensationType.create({ data: { organizationId: t.org.id, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2020-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const medType = await db.employeeDocumentType.create({ data: { organizationId: t.org.id, category: "MEDICAL", code: "SICK_NOTE", name: "Sickness certificate", sensitive: true, standard: false } });
  const otherType = await db.employeeDocumentType.create({ data: { organizationId: t.org.id, category: "EMPLOYMENT", code: "CONTRACT", name: "Contract", standard: false } });
  const doc = (employeeId: string, over: { kind?: "medical" | "other"; archived?: boolean } = {}) => db.employeeDocument.create({ data: { organizationId: t.org.id, employeeId, documentType: over.kind === "other" ? "EMPLOYMENT_CONTRACT" : "MEDICAL_CERTIFICATE", fileReference: `ref-${uid()}`, uploadedBy: "t", typeId: over.kind === "other" ? otherType.id : medType.id, ...(over.archived ? { archivedAt: new Date(), archivedBy: "t" } : {}) } });
  return { t, actor, person, doc };
}

describe("the certificates that can be attached to a spell", () => {
  it("HR sees the company's medical documents with whose they are; a person sees only their own; archived and non-medical ones are left out; nobody else sees any", async () => {
    const w = await world();
    const hr = await w.actor("HR_ADMIN");
    const a = await w.person("A");
    const b = await w.person("B");
    const da = await w.doc(a.id);
    const db_ = await w.doc(b.id);
    await w.doc(a.id, { kind: "other" });
    await w.doc(a.id, { archived: true });
    const all = await listMedicalCertificates(hr);
    expect(all.map((c) => c.id).sort()).toEqual([da.id, db_.id].sort());
    expect(all.find((c) => c.id === da.id)).toMatchObject({ employeeId: a.id, employeeNumber: a.employeeNumber, typeName: "Sickness certificate" });
    const own = await w.actor("EMPLOYEE", 1, a.id);
    expect((await listMedicalCertificates(own)).map((c) => c.id)).toEqual([da.id]);
    const supervisor = await w.actor("SUPERVISOR");
    expect(await listMedicalCertificates(supervisor)).toEqual([]);
    const other = await world();
    expect(await listMedicalCertificates(await other.actor("HR_ADMIN"))).toEqual([]);
  });
});

describe("recording a spell by choosing the certificate (HR)", () => {
  it("takes the employee from the certificate, and needs HR; another company's certificate is not found", async () => {
    const w = await world();
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("FromCert");
    const d = await w.doc(e.id);
    const s = await recordSickSpellFromCertificate(hr, { certificateDocumentId: d.id, startDate: "2043-06-01", endDate: "2043-06-02" });
    expect(s).toMatchObject({ employeeId: e.id, certificateDocumentId: d.id, status: "PENDING", recordedByUserId: hr.userId });
    await expect(recordSickSpellFromCertificate(await w.actor("EMPLOYEE", 1, e.id), { certificateDocumentId: d.id, startDate: "2043-06-08", endDate: "2043-06-08" })).rejects.toThrow();
    const other = await world();
    await expect(recordSickSpellFromCertificate(await other.actor("HR_ADMIN"), { certificateDocumentId: d.id, startDate: "2043-06-01", endDate: "2043-06-02" })).rejects.toThrow(/not found/i);
  });
});

describe("what My leave shows a person about sickness", () => {
  it("is nothing while paid sick leave is not set up, for a person paid monthly, and for an account with no employee", async () => {
    const off = await world(0);
    const hourly = await off.person("Off");
    expect(await mySickLeave(await off.actor("EMPLOYEE", 1, hourly.id))).toMatchObject({ show: false });
    const on = await world(5);
    const monthly = await on.person("Monthly", false);
    expect(await mySickLeave(await on.actor("EMPLOYEE", 1, monthly.id))).toMatchObject({ show: false });
    expect(await mySickLeave(await on.actor("EMPLOYEE", 2, null))).toBeNull();
  });

  it("for a person paid by the hour: the days of the leave year, their own spells and their own medical certificates", async () => {
    const w = await world();
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("Mine");
    const other = await w.person("Other");
    const d = await w.doc(e.id);
    await w.doc(other.id);
    const mine = await recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: d.id });
    await recordSickSpell(hr, { employeeId: other.id, startDate: "2043-06-01", endDate: "2043-06-02", certificateDocumentId: (await w.doc(other.id)).id });
    const me = await mySickLeave(await w.actor("EMPLOYEE", 1, e.id));
    expect(me).toMatchObject({ show: true, entitled: 5 });
    expect(me!.spells.map((s) => s.id)).toEqual([mine.id]);
    expect(me!.certificates.map((c) => c.id)).toEqual([d.id]);
    expect(me!.balance).toMatchObject({ due: true, entitled: 5 });
  });
});

describe("the list HR sees", () => {
  it("names the employee on every spell, newest first", async () => {
    const w = await world();
    const hr = await w.actor("HR_ADMIN");
    const e = await w.person("Named");
    const d = await w.doc(e.id);
    await recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-01", endDate: "2043-06-01", certificateDocumentId: d.id });
    await recordSickSpell(hr, { employeeId: e.id, startDate: "2043-06-08", endDate: "2043-06-08", certificateDocumentId: d.id });
    const rows = await listSickSpells(hr, {});
    expect(rows.map((r) => r.startDate.toISOString().slice(0, 10))).toEqual(["2043-06-08", "2043-06-01"]);
    expect(rows[0].employee).toMatchObject({ employeeNumber: e.employeeNumber, firstName: "Sc" });
  });
});
