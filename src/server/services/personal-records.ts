/**
 * Personal records: next of kin, emergency contacts, dependants, referees and guarantors.
 *
 * Contacts can be kept by the employee (self-service) or by HR. Guarantors are HR-only and go through
 * a check: recorded PENDING, then VERIFIED (identity and signed form on file, optionally by a second
 * person) or REJECTED, and RELEASED once no longer needed. How many of each an employee needs, which
 * categories need guarantors and how many people one guarantor may stand for are in the HR policy.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d } from "@/lib/dates";
import {
  assessRecords,
  BENEFICIARY_KINDS,
  benefitShares,
  CONTACT_KINDS,
  GUARANTOR_ID_TYPES,
  PRIMARY_KINDS,
  sameId,
  samePhone,
} from "@/lib/personal-records";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const GONE = ["EXITED", "TERMINATED", "RESIGNED"] as const;
const ACTIVE_GUARANTOR = ["PENDING", "VERIFIED"] as const;

// ───────────────────────────── Access ─────────────────────────────

async function loadEmployee(ctx: Ctx, employeeId: string) {
  const e = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId } });
  if (!e) throw new BusinessError("Employee not found.");
  return e;
}

const isSelf = (ctx: Ctx, employeeId: string) => !!ctx.employeeId && ctx.employeeId === employeeId && can(ctx.role, "self.view");

/** Contacts: HR sees and edits everyone's; an employee sees and edits their own. */
function assertContactAccess(ctx: Ctx, employeeId: string, mode: "view" | "edit") {
  if (isSelf(ctx, employeeId)) return;
  assertCan(ctx, mode === "view" ? "employee.sensitive" : "hr.manage");
}

// ───────────────────────────── Contacts ─────────────────────────────

export const contactSchema = z.object({
  kind: z.enum(CONTACT_KINDS),
  fullName: z.string().trim().min(2, "Enter the person's full name"),
  relationship: z.string().trim().min(2, "Say how they're related to the employee"),
  phone: opt,
  altPhone: opt,
  email: z
    .string()
    .trim()
    .email("That isn't a valid email address")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: opt,
  dateOfBirth: opt,
  occupation: opt,
  isPrimary: z.boolean().default(false),
  isBeneficiary: z.boolean().default(false),
  benefitSharePct: z.coerce.number().int().min(1, "A share is at least 1%").max(100, "A share can't exceed 100%").optional(),
  notes: opt,
});
export type ContactInput = z.input<typeof contactSchema>;

/** Rules that depend on the kind of contact. Returns the cleaned values. */
function checkContact(v: z.output<typeof contactSchema>) {
  const label = v.kind.replace(/_/g, " ").toLowerCase();
  if (v.kind !== "DEPENDANT" && !v.phone) throw new BusinessError(`A phone number is required — a ${label} has to be reachable.`);
  let dob: Date | undefined;
  if (v.dateOfBirth) {
    dob = d(v.dateOfBirth);
    if (Number.isNaN(dob.getTime())) throw new BusinessError("That date of birth isn't valid.");
    if (dob > todayUtc()) throw new BusinessError("A date of birth can't be in the future.");
  }
  if (v.kind === "DEPENDANT" && !dob) throw new BusinessError("A dependant's date of birth is required.");
  if (v.isPrimary && !PRIMARY_KINDS.includes(v.kind)) throw new BusinessError(`There is no "main" ${label} — only next of kin and emergency contacts have one.`);
  if (v.isBeneficiary && !BENEFICIARY_KINDS.includes(v.kind)) throw new BusinessError(`A ${label} can't be a beneficiary — only next of kin and dependants can.`);
  if (v.isBeneficiary && !v.benefitSharePct) throw new BusinessError("Give the beneficiary's share of the benefit (a percentage).");
  return { ...v, dateOfBirth: dob, benefitSharePct: v.isBeneficiary ? v.benefitSharePct : undefined };
}

export async function listContacts(ctx: Ctx, employeeId: string) {
  assertContactAccess(ctx, employeeId, "view");
  await loadEmployee(ctx, employeeId);
  return db.employeeContact.findMany({
    where: { organizationId: ctx.orgId, employeeId },
    orderBy: [{ kind: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

/** Everyone else's benefit shares, to check the new total fits within 100%. */
async function otherShares(orgId: string, employeeId: string, exceptId?: string) {
  const rows = await db.employeeContact.findMany({ where: { organizationId: orgId, employeeId, isBeneficiary: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  return benefitShares(rows).total;
}

export async function addContact(ctx: Ctx, employeeId: string, raw: ContactInput) {
  assertContactAccess(ctx, employeeId, "edit");
  const emp = await loadEmployee(ctx, employeeId);
  if (GONE.includes(emp.status as never)) throw new BusinessError("This employee has left — their personal records can no longer be changed.");
  const v = checkContact(contactSchema.parse(raw));
  const existing = await db.employeeContact.findMany({ where: { organizationId: ctx.orgId, employeeId, kind: v.kind } });
  if (existing.some((c) => c.fullName.toLowerCase() === v.fullName.toLowerCase() && (c.phone ?? "") === (v.phone ?? "")))
    throw new BusinessError(`${v.fullName} is already recorded as a ${v.kind.replace(/_/g, " ").toLowerCase()}.`);
  if (v.isBeneficiary) {
    const total = (await otherShares(ctx.orgId, employeeId)) + (v.benefitSharePct ?? 0);
    if (total > 100) throw new BusinessError(`Beneficiary shares would total ${total}% — they can't go over 100%.`);
  }
  const primary = v.isPrimary || (PRIMARY_KINDS.includes(v.kind) && !existing.some((c) => c.isPrimary)); // the first one is the main one
  return db.$transaction(async (tx) => {
    if (primary) await tx.employeeContact.updateMany({ where: { organizationId: ctx.orgId, employeeId, kind: v.kind, isPrimary: true }, data: { isPrimary: false } });
    const c = await tx.employeeContact.create({
      data: {
        organizationId: ctx.orgId,
        employeeId,
        kind: v.kind,
        fullName: v.fullName,
        relationship: v.relationship,
        phone: v.phone ?? null,
        altPhone: v.altPhone ?? null,
        email: v.email ?? null,
        address: v.address ?? null,
        dateOfBirth: v.dateOfBirth ?? null,
        occupation: v.occupation ?? null,
        isPrimary: primary,
        isBeneficiary: v.isBeneficiary,
        benefitSharePct: v.benefitSharePct ?? null,
        notes: v.notes ?? null,
        createdBy: ctx.name,
      },
    });
    await logAudit(ctx, { action: "CONTACT_ADD", entity: "Employee", entityId: employeeId, newValue: { kind: c.kind, fullName: c.fullName, relationship: c.relationship } }, tx);
    return c;
  });
}

async function loadContact(ctx: Ctx, id: string) {
  const c = await db.employeeContact.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!c) throw new BusinessError("Contact not found.");
  assertContactAccess(ctx, c.employeeId, "edit");
  const emp = await loadEmployee(ctx, c.employeeId);
  if (GONE.includes(emp.status as never)) throw new BusinessError("This employee has left — their personal records can no longer be changed.");
  return c;
}

/** A contact's kind can't change — remove it and add the right one instead. */
export async function updateContact(ctx: Ctx, id: string, raw: Omit<ContactInput, "kind">) {
  const c = await loadContact(ctx, id);
  const v = checkContact(contactSchema.parse({ ...raw, kind: c.kind }));
  if (v.isBeneficiary) {
    const total = (await otherShares(ctx.orgId, c.employeeId, id)) + (v.benefitSharePct ?? 0);
    if (total > 100) throw new BusinessError(`Beneficiary shares would total ${total}% — they can't go over 100%.`);
  }
  return db.$transaction(async (tx) => {
    if (v.isPrimary) await tx.employeeContact.updateMany({ where: { organizationId: ctx.orgId, employeeId: c.employeeId, kind: c.kind, isPrimary: true, id: { not: id } }, data: { isPrimary: false } });
    const u = await tx.employeeContact.update({
      where: { id },
      data: {
        fullName: v.fullName,
        relationship: v.relationship,
        phone: v.phone ?? null,
        altPhone: v.altPhone ?? null,
        email: v.email ?? null,
        address: v.address ?? null,
        dateOfBirth: v.dateOfBirth ?? null,
        occupation: v.occupation ?? null,
        // un-ticking "main" on the only main contact would leave none — keep it
        isPrimary: v.isPrimary || c.isPrimary,
        isBeneficiary: v.isBeneficiary,
        benefitSharePct: v.benefitSharePct ?? null,
        notes: v.notes ?? null,
      },
    });
    await logAudit(ctx, { action: "CONTACT_UPDATE", entity: "Employee", entityId: c.employeeId, oldValue: { fullName: c.fullName, phone: c.phone }, newValue: { fullName: u.fullName, phone: u.phone } }, tx);
    return u;
  });
}

export async function setPrimaryContact(ctx: Ctx, id: string) {
  const c = await loadContact(ctx, id);
  if (!PRIMARY_KINDS.includes(c.kind)) throw new BusinessError("Only next of kin and emergency contacts have a main one.");
  await db.$transaction(async (tx) => {
    await tx.employeeContact.updateMany({ where: { organizationId: ctx.orgId, employeeId: c.employeeId, kind: c.kind }, data: { isPrimary: false } });
    await tx.employeeContact.update({ where: { id }, data: { isPrimary: true } });
    await logAudit(ctx, { action: "CONTACT_PRIMARY", entity: "Employee", entityId: c.employeeId, newValue: { kind: c.kind, fullName: c.fullName } }, tx);
  });
}

export async function removeContact(ctx: Ctx, id: string) {
  const c = await loadContact(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.employeeContact.delete({ where: { id } });
    if (c.isPrimary) {
      // the oldest remaining one of that kind becomes the main one
      const next = await tx.employeeContact.findFirst({ where: { organizationId: ctx.orgId, employeeId: c.employeeId, kind: c.kind }, orderBy: { createdAt: "asc" } });
      if (next) await tx.employeeContact.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await logAudit(ctx, { action: "CONTACT_REMOVE", entity: "Employee", entityId: c.employeeId, oldValue: { kind: c.kind, fullName: c.fullName } }, tx);
  });
}

// ───────────────────────────── Guarantors ─────────────────────────────

export const guarantorSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the guarantor's full name"),
  relationship: z.string().trim().min(2, "Say how the guarantor knows the employee"),
  phone: z.string().trim().min(7, "The guarantor's phone number is required"),
  altPhone: opt,
  email: z
    .string()
    .trim()
    .email("That isn't a valid email address")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: z.string().trim().min(5, "The guarantor's home address is required"),
  occupation: opt,
  employer: opt,
  employerAddress: opt,
  idType: z.enum(GUARANTOR_ID_TYPES.map((t) => t.value) as [string, ...string[]]).optional(),
  idNumber: opt,
  yearsKnown: z.coerce.number().int().min(0).max(80).optional(),
  guaranteeAmount: z.coerce.number().positive("The guaranteed amount must be more than zero").optional(),
  formReference: opt,
});
export type GuarantorInput = z.input<typeof guarantorSchema>;

type GuarantorValues = z.output<typeof guarantorSchema>;

/** The checks that apply whenever a guarantor is recorded or their identity details change. */
async function checkGuarantor(ctx: Ctx, emp: { id: string; phone: string | null }, v: GuarantorValues, exceptId?: string) {
  if (samePhone(v.phone, emp.phone) || samePhone(v.altPhone, emp.phone)) throw new BusinessError("The guarantor's phone number is the employee's own — a guarantor must be a separate, reachable person.");
  if (v.idNumber && !v.idType) throw new BusinessError("Say what kind of ID the number is from.");
  const live = await db.employeeGuarantor.findMany({
    where: { organizationId: ctx.orgId, status: { in: [...ACTIVE_GUARANTOR] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { employeeId: true, phone: true, idNumber: true, fullName: true },
  });
  const same = live.filter((g) => samePhone(g.phone, v.phone) || sameId(g.idNumber, v.idNumber));
  if (same.some((g) => g.employeeId === emp.id)) throw new BusinessError("This person (same phone or ID) is already one of this employee's guarantors.");
  const policy = await getHrPolicy(ctx.orgId);
  const others = new Set(same.map((g) => g.employeeId));
  if (policy.guarantorMaxPerPerson > 0 && others.size >= policy.guarantorMaxPerPerson)
    throw new BusinessError(`${v.fullName} already guarantees ${others.size} other employee(s) — the limit is ${policy.guarantorMaxPerPerson}.`);
}

export async function addGuarantor(ctx: Ctx, employeeId: string, raw: GuarantorInput) {
  assertCan(ctx, "hr.manage");
  const emp = await loadEmployee(ctx, employeeId);
  if (GONE.includes(emp.status as never)) throw new BusinessError("This employee has left — guarantors can no longer be added.");
  const v = guarantorSchema.parse(raw);
  await checkGuarantor(ctx, emp, v);
  return db.$transaction(async (tx) => {
    const g = await tx.employeeGuarantor.create({
      data: {
        organizationId: ctx.orgId,
        employeeId,
        fullName: v.fullName,
        relationship: v.relationship,
        phone: v.phone,
        altPhone: v.altPhone ?? null,
        email: v.email ?? null,
        address: v.address,
        occupation: v.occupation ?? null,
        employer: v.employer ?? null,
        employerAddress: v.employerAddress ?? null,
        idType: v.idType ?? null,
        idNumber: v.idNumber ?? null,
        yearsKnown: v.yearsKnown ?? null,
        guaranteeAmount: v.guaranteeAmount ?? null,
        formReference: v.formReference ?? null,
        recordedBy: ctx.name,
        recordedByUserId: ctx.userId,
      },
    });
    await logAudit(ctx, { action: "GUARANTOR_ADD", entity: "Employee", entityId: employeeId, newValue: { guarantor: g.fullName, relationship: g.relationship } }, tx);
    return g;
  });
}

async function loadGuarantor(ctx: Ctx, id: string) {
  const g = await db.employeeGuarantor.findFirst({ where: { id, organizationId: ctx.orgId }, include: { employee: true } });
  if (!g) throw new BusinessError("Guarantor not found.");
  return g;
}

// Changing any of these means the guarantor has to be checked again.
const IDENTITY_FIELDS = ["fullName", "phone", "address", "idType", "idNumber", "formReference"] as const;

export async function updateGuarantor(ctx: Ctx, id: string, raw: GuarantorInput) {
  assertCan(ctx, "hr.manage");
  const g = await loadGuarantor(ctx, id);
  if (g.status === "RELEASED") throw new BusinessError("This guarantor has been released and can't be edited.");
  if (GONE.includes(g.employee.status as never)) throw new BusinessError("This employee has left — guarantors can no longer be changed.");
  const v = guarantorSchema.parse(raw);
  await checkGuarantor(ctx, g.employee, v, id);
  const changed = IDENTITY_FIELDS.some((f) => (v[f] ?? null) !== (g[f] ?? null));
  const recheck = changed && (g.status === "VERIFIED" || g.status === "REJECTED");
  return db.$transaction(async (tx) => {
    const u = await tx.employeeGuarantor.update({
      where: { id },
      data: {
        fullName: v.fullName,
        relationship: v.relationship,
        phone: v.phone,
        altPhone: v.altPhone ?? null,
        email: v.email ?? null,
        address: v.address,
        occupation: v.occupation ?? null,
        employer: v.employer ?? null,
        employerAddress: v.employerAddress ?? null,
        idType: v.idType ?? null,
        idNumber: v.idNumber ?? null,
        yearsKnown: v.yearsKnown ?? null,
        guaranteeAmount: v.guaranteeAmount ?? null,
        formReference: v.formReference ?? null,
        ...(recheck ? { status: "PENDING", verifiedBy: null, verifiedByUserId: null, verifiedAt: null, verificationNote: null } : {}),
      },
    });
    await logAudit(ctx, { action: "GUARANTOR_UPDATE", entity: "Employee", entityId: g.employeeId, oldValue: { guarantor: g.fullName, status: g.status }, newValue: { guarantor: u.fullName, status: u.status }, reason: recheck ? "Identity details changed — verification reset" : undefined }, tx);
    return u;
  });
}

export async function verifyGuarantor(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "hr.manage");
  const g = await loadGuarantor(ctx, id);
  if (g.status !== "PENDING") throw new BusinessError(`This guarantor is already ${g.status.toLowerCase()}.`);
  if (!note || note.trim().length < 3) throw new BusinessError("Say how you verified them (e.g. called and visited the address).");
  const missing = [!g.idType || !g.idNumber ? "an ID type and number" : null, !g.formReference ? "the signed guarantee form reference" : null].filter(Boolean);
  if (missing.length) throw new BusinessError(`Add ${missing.join(" and ")} before verifying.`);
  const policy = await getHrPolicy(ctx.orgId);
  if (policy.guarantorSeparateVerifier && g.recordedByUserId === ctx.userId) throw new BusinessError("You recorded this guarantor — someone else has to verify them.");
  const u = await db.employeeGuarantor.update({
    where: { id },
    data: { status: "VERIFIED", verifiedBy: ctx.name, verifiedByUserId: ctx.userId, verifiedAt: new Date(), verificationNote: note.trim() },
  });
  await logAudit(ctx, { action: "GUARANTOR_VERIFY", entity: "Employee", entityId: g.employeeId, newValue: { guarantor: g.fullName }, reason: note });
  return u;
}

export async function rejectGuarantor(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  const g = await loadGuarantor(ctx, id);
  if (g.status !== "PENDING") throw new BusinessError(`This guarantor is already ${g.status.toLowerCase()}.`);
  if (!reason || reason.trim().length < 3) throw new BusinessError("Give a reason.");
  const u = await db.employeeGuarantor.update({
    where: { id },
    data: { status: "REJECTED", verifiedBy: ctx.name, verifiedByUserId: ctx.userId, verifiedAt: new Date(), verificationNote: reason.trim() },
  });
  await logAudit(ctx, { action: "GUARANTOR_REJECT", entity: "Employee", entityId: g.employeeId, newValue: { guarantor: g.fullName }, reason });
  return u;
}

export async function releaseGuarantor(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  const g = await loadGuarantor(ctx, id);
  if (g.status === "RELEASED") throw new BusinessError("This guarantor has already been released.");
  if (!reason || reason.trim().length < 3) throw new BusinessError("Give a reason.");
  const u = await db.employeeGuarantor.update({ where: { id }, data: { status: "RELEASED", releasedAt: new Date(), releaseReason: reason.trim() } });
  await logAudit(ctx, { action: "GUARANTOR_RELEASE", entity: "Employee", entityId: g.employeeId, oldValue: { status: g.status }, newValue: { guarantor: g.fullName }, reason });
  return u;
}

/** A pending or rejected entry can be deleted (a mistake); a verified one is released instead, so the history stays. */
export async function deleteGuarantor(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const g = await loadGuarantor(ctx, id);
  if (g.status === "VERIFIED" || g.status === "RELEASED") throw new BusinessError("A verified guarantor is part of the record — release them instead of deleting.");
  await db.employeeGuarantor.delete({ where: { id } });
  await logAudit(ctx, { action: "GUARANTOR_DELETE", entity: "Employee", entityId: g.employeeId, oldValue: { guarantor: g.fullName, status: g.status } });
}

export async function listGuarantors(ctx: Ctx, f: { employeeId?: string; status?: string } = {}) {
  assertCan(ctx, "employee.sensitive");
  return db.employeeGuarantor.findMany({
    where: { organizationId: ctx.orgId, ...(f.employeeId ? { employeeId: f.employeeId } : {}), ...(f.status ? { status: f.status as never } : {}) },
    include: { employee: { select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, status: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

// ───────────────────────────── Completeness ─────────────────────────────

/** Every current employee against the policy: who is missing what. */
export async function recordsOverview(ctx: Ctx) {
  assertCan(ctx, "employee.sensitive");
  const policy = await getHrPolicy(ctx.orgId);
  const [emps, contacts, guarantors] = await Promise.all([
    db.employee.findMany({
      where: { organizationId: ctx.orgId, status: { notIn: [...GONE] } },
      select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, categoryId: true, category: { select: { name: true } } },
      orderBy: { employeeNumber: "asc" },
    }),
    db.employeeContact.findMany({ where: { organizationId: ctx.orgId } }),
    db.employeeGuarantor.findMany({ where: { organizationId: ctx.orgId, status: { not: "RELEASED" } } }),
  ]);
  const rows = emps.map((e) => {
    const cs = contacts.filter((c) => c.employeeId === e.id);
    const gs = guarantors.filter((g) => g.employeeId === e.id);
    return {
      employee: e,
      contacts: cs,
      guarantors: gs,
      gaps: assessRecords(policy, e.categoryId, cs, gs),
      shares: benefitShares(cs),
    };
  });
  return {
    policy,
    rows,
    totals: {
      employees: rows.length,
      complete: rows.filter((r) => r.gaps.complete).length,
      noNextOfKin: rows.filter((r) => r.gaps.nextOfKinMissing > 0).length,
      noEmergency: rows.filter((r) => r.gaps.emergencyMissing > 0).length,
      guarantorShort: rows.filter((r) => r.gaps.guarantorsMissing > 0).length,
      guarantorsPending: guarantors.filter((g) => g.status === "PENDING").length,
      guarantorsRejected: guarantors.filter((g) => g.status === "REJECTED").length,
      badShares: rows.filter((r) => r.shares.count > 0 && !r.shares.complete).length,
    },
  };
}

/** One employee's records against the policy, for the employee page and self-service. */
export async function recordsStatus(ctx: Ctx, employeeId: string) {
  assertContactAccess(ctx, employeeId, "view");
  const emp = await loadEmployee(ctx, employeeId);
  const policy = await getHrPolicy(ctx.orgId);
  const [contacts, guarantors] = await Promise.all([
    db.employeeContact.findMany({ where: { organizationId: ctx.orgId, employeeId } }),
    // guarantor detail is HR-only, but the count against the requirement is shown to the employee too
    db.employeeGuarantor.findMany({ where: { organizationId: ctx.orgId, employeeId, status: { not: "RELEASED" } } }),
  ]);
  return { gaps: assessRecords(policy, emp.categoryId, contacts, guarantors), shares: benefitShares(contacts) };
}
