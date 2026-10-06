import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ctxFor, isolatedOrg } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { updateHrPolicy } from "@/server/services/hr-policy";
import {
  addContact,
  addGuarantor,
  deleteGuarantor,
  listContacts,
  listGuarantors,
  recordsOverview,
  recordsStatus,
  rejectGuarantor,
  releaseGuarantor,
  removeContact,
  setPrimaryContact,
  updateContact,
  updateGuarantor,
  verifyGuarantor,
} from "@/server/services/personal-records";

type Org = Awaited<ReturnType<typeof isolatedOrg>>;

async function staff(t: Org, first: string, opts: { office?: boolean; phone?: string } = {}) {
  return createEmployee(t.ctx("HR_ADMIN"), {
    firstName: first,
    lastName: "Records",
    employmentDate: "2024-01-01",
    categoryId: opts.office ? t.officeId : t.guardId,
    phone: opts.phone,
  });
}

const kin = (over: Record<string, unknown> = {}) => ({ kind: "NEXT_OF_KIN" as const, fullName: "Ngozi Okafor", relationship: "Spouse", phone: "08025550001", ...over });
let n = 0;
const guarantor = (over: Record<string, unknown> = {}) => {
  n += 1;
  return {
    fullName: `Guarantor ${n}`,
    relationship: "Friend",
    phone: `0803000${String(n).padStart(4, "0")}`,
    address: "12 Allen Avenue, Ikeja",
    idType: "NIN" as const,
    idNumber: `NIN${1000 + n}`,
    formReference: `GF-${n}`,
    ...over,
  };
};

describe("contacts", () => {
  it("makes the first next of kin the main one, and keeps exactly one main", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Main");
    const a = await addContact(hr, e.id, kin());
    const b = await addContact(hr, e.id, kin({ fullName: "Chidi Okafor", relationship: "Sibling", phone: "08025550002" }));
    expect([a.isPrimary, b.isPrimary]).toEqual([true, false]);

    await setPrimaryContact(hr, b.id);
    let rows = await listContacts(hr, e.id);
    expect(rows.filter((r) => r.isPrimary).map((r) => r.fullName)).toEqual(["Chidi Okafor"]);

    // adding one marked main takes over
    const c = await addContact(hr, e.id, kin({ fullName: "Ada Okafor", relationship: "Parent", phone: "08025550003", isPrimary: true }));
    rows = await listContacts(hr, e.id);
    expect(rows.filter((r) => r.isPrimary).map((r) => r.id)).toEqual([c.id]);

    // removing the main promotes the oldest remaining
    await removeContact(hr, c.id);
    rows = await listContacts(hr, e.id);
    expect(rows.filter((r) => r.isPrimary).map((r) => r.fullName)).toEqual(["Ngozi Okafor"]);

    // emergency contacts have their own main
    const em = await addContact(hr, e.id, { kind: "EMERGENCY_CONTACT", fullName: "Uncle Bayo", relationship: "Relative", phone: "08025550009" });
    expect(em.isPrimary).toBe(true);
    expect((await listContacts(hr, e.id)).filter((r) => r.isPrimary)).toHaveLength(2);
  });

  it("applies the rules for each kind", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Rules");
    await expect(addContact(hr, e.id, kin({ phone: undefined }))).rejects.toThrow(/phone number is required/);
    await expect(addContact(hr, e.id, { kind: "DEPENDANT", fullName: "Little One", relationship: "Child" })).rejects.toThrow(/date of birth is required/);
    await expect(addContact(hr, e.id, { kind: "DEPENDANT", fullName: "Little One", relationship: "Child", dateOfBirth: "2999-01-01" })).rejects.toThrow(/future/);
    await expect(addContact(hr, e.id, { kind: "DEPENDANT", fullName: "Little One", relationship: "Child", dateOfBirth: "2018-03-04", isPrimary: true })).rejects.toThrow(/no "main"/);
    await expect(addContact(hr, e.id, { kind: "EMERGENCY_CONTACT", fullName: "Not Heir", relationship: "Friend", phone: "08025550004", isBeneficiary: true, benefitSharePct: 10 })).rejects.toThrow(/can't be a beneficiary/);
    await expect(addContact(hr, e.id, kin({ isBeneficiary: true }))).rejects.toThrow(/share/);
    await expect(addContact(hr, e.id, kin({ email: "not-an-email" }))).rejects.toThrow();
    // a dependant needs no phone
    const kid = await addContact(hr, e.id, { kind: "DEPENDANT", fullName: "Little One", relationship: "Child", dateOfBirth: "2018-03-04" });
    expect(kid.phone).toBeNull();
    // the same person twice is a double entry
    await addContact(hr, e.id, kin());
    await expect(addContact(hr, e.id, kin())).rejects.toThrow(/already recorded/);
  });

  it("keeps beneficiary shares within 100%, on add and on edit", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Shares");
    const a = await addContact(hr, e.id, kin({ isBeneficiary: true, benefitSharePct: 60 }));
    await expect(addContact(hr, e.id, { kind: "DEPENDANT", fullName: "Kid One", relationship: "Child", dateOfBirth: "2015-01-01", isBeneficiary: true, benefitSharePct: 50 })).rejects.toThrow(/110%/);
    const b = await addContact(hr, e.id, { kind: "DEPENDANT", fullName: "Kid One", relationship: "Child", dateOfBirth: "2015-01-01", isBeneficiary: true, benefitSharePct: 40 });
    expect((await recordsStatus(hr, e.id)).shares).toMatchObject({ total: 100, complete: true });
    await expect(updateContact(hr, b.id, { fullName: "Kid One", relationship: "Child", dateOfBirth: "2015-01-01", isBeneficiary: true, benefitSharePct: 45 })).rejects.toThrow(/105%/);
    // editing a share down is fine, and editing never changes the kind
    const u = await updateContact(hr, a.id, { fullName: "Ngozi Okafor", relationship: "Spouse", phone: "08025550001", isBeneficiary: true, benefitSharePct: 55 });
    expect(u.benefitSharePct).toBe(55);
    expect(u.kind).toBe("NEXT_OF_KIN");
    expect((await recordsStatus(hr, e.id)).shares).toMatchObject({ total: 95, complete: false });
    // an edit can't drop the only main contact
    const still = await updateContact(hr, a.id, { fullName: "Ngozi Okafor", relationship: "Spouse", phone: "08025550001", isPrimary: false });
    expect(still.isPrimary).toBe(true);
  });

  it("lets an employee keep their own contacts, and no one else's", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const me = await staff(t, "Mine");
    const other = await staff(t, "Theirs");
    const self = t.ctx("EMPLOYEE", me.id);
    const c = await addContact(self, me.id, kin());
    expect((await listContacts(self, me.id)).map((r) => r.id)).toEqual([c.id]);
    expect((await updateContact(self, c.id, { fullName: "Ngozi O.", relationship: "Spouse", phone: "08025550001" })).fullName).toBe("Ngozi O.");
    expect((await recordsStatus(self, me.id)).gaps.nextOfKinMissing).toBe(0);

    await expect(addContact(self, other.id, kin())).rejects.toThrow();
    await expect(listContacts(self, other.id)).rejects.toThrow();
    const theirs = await addContact(hr, other.id, kin({ fullName: "Their Spouse", phone: "08025550077" }));
    await expect(removeContact(self, theirs.id)).rejects.toThrow();
    await expect(updateContact(self, theirs.id, { fullName: "x y", relationship: "Friend", phone: "08025550078" })).rejects.toThrow();
    await expect(setPrimaryContact(self, theirs.id)).rejects.toThrow();

    // an unlinked login, or someone with view-only rights, can't write
    await expect(addContact(t.ctx("EMPLOYEE"), me.id, kin({ fullName: "Sneaky One" }))).rejects.toThrow();
    await expect(addContact(t.ctx("AUDITOR"), me.id, kin({ fullName: "Auditor Added" }))).rejects.toThrow();
    expect((await listContacts(t.ctx("AUDITOR"), me.id)).length).toBe(1);
    await expect(listContacts(t.ctx("OPERATIONS"), me.id)).rejects.toThrow();
  });

  it("stays inside the organization and is audited; leavers' records are frozen", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const e = await staff(a, "Tenant");
    await expect(listContacts(b.ctx("HR_ADMIN"), e.id)).rejects.toThrow(/not found/);
    await expect(addContact(b.ctx("HR_ADMIN"), e.id, kin())).rejects.toThrow(/not found/);
    const c = await addContact(a.ctx("HR_ADMIN"), e.id, kin());
    await expect(removeContact(b.ctx("HR_ADMIN"), c.id)).rejects.toThrow(/not found/);
    expect(await db.auditLog.count({ where: { organizationId: a.org.id, action: "CONTACT_ADD" } })).toBe(1);

    await db.employee.update({ where: { id: e.id }, data: { status: "RESIGNED" } });
    await expect(addContact(a.ctx("HR_ADMIN"), e.id, kin({ fullName: "Too Late" }))).rejects.toThrow(/has left/);
    await expect(removeContact(a.ctx("HR_ADMIN"), c.id)).rejects.toThrow(/has left/);
  });
});

describe("guarantors", () => {
  it("is recorded pending, needs ID and form to verify, and keeps who verified", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Vouched", { phone: "08031110000" });
    const g = await addGuarantor(hr, e.id, guarantor({ idType: undefined, idNumber: undefined, formReference: undefined }));
    expect(g.status).toBe("PENDING");
    await expect(verifyGuarantor(hr, g.id, "Called him")).rejects.toThrow(/ID type and number and the signed guarantee form/);
    const withId = await updateGuarantor(hr, g.id, guarantor({ fullName: g.fullName, phone: g.phone, idNumber: "NIN99999", formReference: undefined }));
    expect(withId.status).toBe("PENDING");
    await expect(verifyGuarantor(hr, g.id, "Called him")).rejects.toThrow(/signed guarantee form/);
    await updateGuarantor(hr, g.id, guarantor({ fullName: g.fullName, phone: g.phone, idNumber: "NIN99999", formReference: "GF-77" }));
    await expect(verifyGuarantor(hr, g.id, "")).rejects.toThrow(/how you verified/);
    await expect(verifyGuarantor(t.ctx("AUDITOR"), g.id, "Called him")).rejects.toThrow();
    const v = await verifyGuarantor(hr, g.id, "Called him and visited the address");
    expect(v).toMatchObject({ status: "VERIFIED", verifiedBy: hr.name });
    expect(v.verifiedAt).not.toBeNull();
    await expect(verifyGuarantor(hr, g.id, "Again")).rejects.toThrow(/already verified/);
    expect((await recordsStatus(hr, e.id)).gaps).toMatchObject({ guarantorsVerified: 1, guarantorsMissing: 1 });
  });

  it("rejects a guarantor who is the employee, or a repeat of the same person", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Self", { phone: "08031110000" });
    await expect(addGuarantor(hr, e.id, guarantor({ phone: "+234 803 111 0000" }))).rejects.toThrow(/employee's own/);
    await expect(addGuarantor(hr, e.id, guarantor({ idType: undefined }))).rejects.toThrow(/what kind of ID/);
    await expect(addGuarantor(hr, e.id, guarantor({ phone: "123" }))).rejects.toThrow();
    const g = await addGuarantor(hr, e.id, guarantor());
    await expect(addGuarantor(hr, e.id, guarantor({ phone: g.phone, fullName: "Same Phone" }))).rejects.toThrow(/already one of/);
    await expect(addGuarantor(hr, e.id, guarantor({ idNumber: g.idNumber, fullName: "Same ID" }))).rejects.toThrow(/already one of/);
  });

  it("limits how many employees one person may guarantee, whichever way the phone is written", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await updateHrPolicy(hr, { guarantorMaxPerPerson: 2 });
    const shared = guarantor({ phone: "08037770000", idNumber: "SHARED-1" });
    const e1 = await staff(t, "One");
    const e2 = await staff(t, "Two");
    const e3 = await staff(t, "Three");
    const g1 = await addGuarantor(hr, e1.id, shared);
    await addGuarantor(hr, e2.id, { ...shared, phone: "+234 803 777 0000", idNumber: "other" });
    await expect(addGuarantor(hr, e3.id, { ...shared, idNumber: "yet-another" })).rejects.toThrow(/already guarantees 2 other/);
    // a rejected or released guarantor stops counting
    await releaseGuarantor(hr, g1.id, "Employee transferred out");
    await addGuarantor(hr, e3.id, { ...shared, idNumber: "yet-another" });
    // 0 = no limit
    await updateHrPolicy(hr, { guarantorMaxPerPerson: 0 });
    const e4 = await staff(t, "Four");
    await addGuarantor(hr, e4.id, { ...shared, idNumber: "fourth" });
  });

  it("makes a verified guarantor go back to pending when their identity details change", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Reset");
    const g = await addGuarantor(hr, e.id, guarantor());
    await verifyGuarantor(hr, g.id, "Visited");
    const same = { fullName: g.fullName, relationship: g.relationship, phone: g.phone, address: g.address, idType: "NIN" as const, idNumber: g.idNumber!, formReference: g.formReference! };

    // a change that isn't about who they are leaves the verification alone
    const kept = await updateGuarantor(hr, g.id, { ...same, occupation: "Trader", yearsKnown: 8 });
    expect(kept).toMatchObject({ status: "VERIFIED", occupation: "Trader" });

    // a new phone number means checking again
    const reset = await updateGuarantor(hr, g.id, { ...same, phone: "08038889999" });
    expect(reset).toMatchObject({ status: "PENDING", verifiedBy: null, verifiedAt: null, verificationNote: null });
    expect((await db.auditLog.findFirst({ where: { organizationId: t.org.id, action: "GUARANTOR_UPDATE", reason: { contains: "verification reset" } } }))).not.toBeNull();

    // a rejected guarantor who is corrected is given another chance
    await rejectGuarantor(hr, g.id, "Number didn't connect");
    expect((await db.employeeGuarantor.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("REJECTED");
    const again = await updateGuarantor(hr, g.id, { ...same, phone: "08038889998" });
    expect(again.status).toBe("PENDING");
  });

  it("can have a second person verify, when the policy says so", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await updateHrPolicy(hr, { guarantorSeparateVerifier: true });
    const e = await staff(t, "Checked");
    const g = await addGuarantor(hr, e.id, guarantor());
    await expect(verifyGuarantor(hr, g.id, "Visited")).rejects.toThrow(/someone else/);
    await verifyGuarantor(t.ctx("HR_ADMIN", null, 2), g.id, "Visited the address");
    expect((await db.employeeGuarantor.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("VERIFIED");
  });

  it("can be rejected, released or deleted only when that makes sense", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Lifecycle");
    const a = await addGuarantor(hr, e.id, guarantor());
    const b = await addGuarantor(hr, e.id, guarantor());
    await expect(rejectGuarantor(hr, a.id, "")).rejects.toThrow(/reason/);
    await rejectGuarantor(hr, a.id, "Could not be reached");
    await expect(rejectGuarantor(hr, a.id, "Again")).rejects.toThrow(/already rejected/);
    await deleteGuarantor(hr, a.id); // an entry that never worked out can go

    await verifyGuarantor(hr, b.id, "Visited");
    await expect(deleteGuarantor(hr, b.id)).rejects.toThrow(/release them/);
    await expect(releaseGuarantor(hr, b.id, "")).rejects.toThrow(/reason/);
    await releaseGuarantor(hr, b.id, "Replaced by a closer relative");
    await expect(releaseGuarantor(hr, b.id, "Again")).rejects.toThrow(/already been released/);
    await expect(updateGuarantor(hr, b.id, guarantor({ fullName: "Edited" }))).rejects.toThrow(/released/);
    expect((await listGuarantors(hr, { employeeId: e.id })).map((g) => g.status)).toEqual(["RELEASED"]);
  });

  it("is HR's alone to change, visible to those who see sensitive data, and never to the employee", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Guarded");
    await expect(addGuarantor(t.ctx("EMPLOYEE", e.id), e.id, guarantor())).rejects.toThrow();
    await expect(addGuarantor(t.ctx("PAYROLL_ADMIN"), e.id, guarantor())).rejects.toThrow();
    await expect(addGuarantor(t.ctx("AUDITOR"), e.id, guarantor())).rejects.toThrow();
    const g = await addGuarantor(hr, e.id, guarantor());
    await expect(listGuarantors(t.ctx("EMPLOYEE", e.id))).rejects.toThrow();
    await expect(listGuarantors(t.ctx("OPERATIONS"))).rejects.toThrow();
    expect((await listGuarantors(t.ctx("AUDITOR"), { status: "PENDING" })).map((x) => x.id)).toEqual([g.id]);
    // another organization can't reach it
    const other = await isolatedOrg();
    await expect(verifyGuarantor(other.ctx("HR_ADMIN"), g.id, "Visited")).rejects.toThrow(/not found/);
    expect(await listGuarantors(other.ctx("HR_ADMIN"))).toHaveLength(0);
  });

  it("can't be added for someone who has left", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await staff(t, "Gone");
    const g = await addGuarantor(hr, e.id, guarantor());
    await db.employee.update({ where: { id: e.id }, data: { status: "TERMINATED" } });
    await expect(addGuarantor(hr, e.id, guarantor())).rejects.toThrow(/has left/);
    await expect(updateGuarantor(hr, g.id, guarantor({ fullName: "Changed" }))).rejects.toThrow(/has left/);
    // the existing guarantor stays on file (they may be needed to recover what's owed) and can still be released
    await releaseGuarantor(hr, g.id, "Debt cleared");
  });
});

describe("demo data", () => {
  it("seeds the demo organization with every state the pages show", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const o = await recordsOverview(hr);
    const all = await listGuarantors(hr);
    expect(new Set(all.map((g) => g.status))).toEqual(new Set(["VERIFIED", "PENDING", "REJECTED"]));
    expect(o.totals.noNextOfKin).toBeGreaterThan(0); // some staff have nothing on file…
    expect(o.rows.some((r) => r.gaps.complete)).toBe(true); // while a couple are fully compliant
    expect(o.totals.complete).toBeLessThan(o.totals.employees);
    expect(o.rows.some((r) => r.shares.complete)).toBe(true);
  });
});

describe("policy and completeness", () => {
  it("measures every current employee against the policy, by category", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const guard = await staff(t, "Guard");
    const clerk = await staff(t, "Clerk", { office: true });
    const leaver = await staff(t, "Leaver");
    await db.employee.update({ where: { id: leaver.id }, data: { status: "EXITED" } });

    let o = await recordsOverview(hr);
    expect(o.totals).toMatchObject({ employees: 2, complete: 0, noNextOfKin: 2, noEmergency: 2, guarantorShort: 2 }); // leaver excluded

    // guarantors only for guards
    await updateHrPolicy(hr, { guarantorCategoryIds: [t.guardId] });
    await addContact(hr, guard.id, kin());
    await addContact(hr, guard.id, { kind: "EMERGENCY_CONTACT", fullName: "Uncle Bayo", relationship: "Relative", phone: "08025550009" });
    await addContact(hr, clerk.id, kin({ fullName: "Clerk Spouse", phone: "08025550055" }));
    for (let i = 0; i < 2; i++) {
      const g = await addGuarantor(hr, guard.id, guarantor());
      if (i === 0) await verifyGuarantor(hr, g.id, "Visited");
    }
    o = await recordsOverview(hr);
    const row = (id: string) => o.rows.find((r) => r.employee.id === id)!;
    expect(row(guard.id).gaps).toMatchObject({ guarantorsNeeded: 2, guarantorsVerified: 1, guarantorsPending: 1, guarantorsMissing: 1, complete: false });
    expect(row(clerk.id).gaps).toMatchObject({ guarantorsNeeded: 0, nextOfKinMissing: 0, emergencyMissing: 1, complete: false });
    expect(o.totals).toMatchObject({ guarantorShort: 1, guarantorsPending: 1, noNextOfKin: 0, noEmergency: 1 });

    // verifying the second makes the guard complete; relaxing the policy completes the clerk
    const pending = (await listGuarantors(hr, { employeeId: guard.id, status: "PENDING" }))[0];
    await verifyGuarantor(hr, pending.id, "Visited");
    await updateHrPolicy(hr, { emergencyContactsRequired: 0 });
    o = await recordsOverview(hr);
    expect(o.totals).toMatchObject({ employees: 2, complete: 2, guarantorShort: 0 });
  });

  it("validates the policy settings", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await expect(updateHrPolicy(hr, { guarantorsRequired: 6 })).rejects.toThrow();
    await expect(updateHrPolicy(hr, { nextOfKinRequired: -1 })).rejects.toThrow();
    await expect(updateHrPolicy(hr, { guarantorCategoryIds: ["no-such-category"] })).rejects.toThrow(/category/);
    const other = await isolatedOrg();
    await expect(updateHrPolicy(hr, { guarantorCategoryIds: [other.guardId] })).rejects.toThrow(/category/); // another org's category
    const ok = await updateHrPolicy(hr, { guarantorsRequired: 3, guarantorCategoryIds: [t.guardId, t.officeId] });
    expect(ok).toMatchObject({ guarantorsRequired: 3 });
    expect(ok.guarantorCategoryIds).toHaveLength(2);
    await expect(recordsOverview(t.ctx("OPERATIONS"))).rejects.toThrow();
  });
});
