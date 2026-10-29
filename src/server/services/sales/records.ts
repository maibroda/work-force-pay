/**
 * Accounts, contacts and leads for the sales module. Every call: the organization's switch, the permission, then visibility (a sales person sees
 * their own records, a manager all). Phones are stored as E.164, emails in lower case. A record is voided, never deleted. The audit log gets ids and
 * the NAMES of the fields that changed, never the person's name, phone or email, so a person can later be erased without touching the log.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { normalizeCompanyName } from "@/lib/sales/names";
import { normalizeNgPhone } from "@/lib/sales/phone";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { nextNumber } from "../numbering";
import { ownerFilter, requireSales, resolveOwner, seesAll } from "./access";
import { pickOwner } from "./assignment";

const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const email = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined))
  .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "That email address isn't valid.");

const SOURCES = ["REFERRAL", "WALK_IN", "PHONE", "WEBSITE", "WHATSAPP", "TENDER", "EVENT", "EXISTING_CLIENT", "OTHER"] as const;
const SERVICES = ["GUARDING", "CLEANING", "FACILITY", "STAFFING", "OTHER"] as const;
const DECISION_ROLES = ["DECISION_MAKER", "INFLUENCER", "USER", "FINANCE", "PROCUREMENT", "GATEKEEPER"] as const;

function phoneOf(label: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  const p = normalizeNgPhone(value);
  if (!p.ok) throw new BusinessError(`${label}: ${p.reason}`);
  return p.e164;
}

/** The names of the fields a change touches (what the audit log records). */
const fieldNames = (patch: Record<string, unknown>) => Object.keys(patch).filter((k) => patch[k] !== undefined).sort();

// ─────────────────────────────── Accounts ───────────────────────────────

export const accountSchema = z.object({
  name: z.string().trim().min(2, "The company's name is required").max(200),
  industry: text(),
  accountType: z.enum(["PROSPECT", "CLIENT", "FORMER_CLIENT"]).optional(),
  source: z.enum(SOURCES).optional(),
  sourceDetail: text(),
  state: text(60),
  lga: text(60),
  address: text(400),
  rcNumber: text(40),
  emailDomain: text(120),
  parentAccountId: text(60),
  ownerUserId: text(60),
});

async function loadAccount(ctx: Ctx, id: string, opts: { allowVoid?: boolean } = {}) {
  const a = await db.crmAccount.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) } });
  if (!a) throw new BusinessError("Account not found.");
  if (a.status === "VOID" && !opts.allowVoid) throw new BusinessError("A voided account cannot be changed.");
  return a;
}

export async function createAccount(ctx: Ctx, raw: z.input<typeof accountSchema>) {
  await requireSales(ctx, "sales.manage");
  const v = accountSchema.parse(raw);
  const owner = await resolveOwner(ctx, v.ownerUserId);
  if (v.parentAccountId) await loadAccount(ctx, v.parentAccountId);
  const { ownerUserId: _o, ...rest } = v;
  void _o;
  const a = await db.crmAccount.create({
    data: { organizationId: ctx.orgId, ...rest, accountType: v.accountType ?? "PROSPECT", normalizedName: normalizeCompanyName(v.name), emailDomain: v.emailDomain?.toLowerCase(), ...owner, createdBy: ctx.name },
  });
  await logAudit(ctx, { action: "SALES_ACCOUNT_CREATE", entity: "CrmAccount", entityId: a.id, newValue: { fields: fieldNames(v) } });
  return a;
}

export async function updateAccount(ctx: Ctx, id: string, raw: Partial<z.input<typeof accountSchema>>) {
  await requireSales(ctx, "sales.manage");
  const before = await loadAccount(ctx, id);
  const v = accountSchema.partial().parse(raw);
  const owner = v.ownerUserId !== undefined && v.ownerUserId !== before.ownerUserId ? await resolveOwner(ctx, v.ownerUserId) : undefined;
  if (v.parentAccountId) {
    if (v.parentAccountId === id) throw new BusinessError("An account cannot be its own parent.");
    await loadAccount(ctx, v.parentAccountId);
  }
  const { ownerUserId: _o, ...rest } = v;
  void _o;
  const a = await db.crmAccount.update({
    where: { id },
    data: { ...rest, ...(v.name ? { normalizedName: normalizeCompanyName(v.name) } : {}), ...(v.emailDomain ? { emailDomain: v.emailDomain.toLowerCase() } : {}), ...(owner ?? {}) },
  });
  await logAudit(ctx, { action: "SALES_ACCOUNT_UPDATE", entity: "CrmAccount", entityId: id, newValue: { fields: fieldNames({ ...v, ...(owner ? { ownerUserId: 1 } : {}) }) } });
  return a;
}

export async function voidAccount(ctx: Ctx, id: string, reason: string) {
  await requireSales(ctx, "sales.manage");
  await loadAccount(ctx, id);
  if (!reason.trim()) throw new BusinessError("Say why the account is being voided.");
  const a = await db.crmAccount.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidedBy: ctx.name, voidReason: reason.trim() } });
  await logAudit(ctx, { action: "SALES_ACCOUNT_VOID", entity: "CrmAccount", entityId: id });
  return a;
}

export async function listAccounts(ctx: Ctx, f: { q?: string; accountType?: string; ownerUserId?: string } = {}) {
  await requireSales(ctx, "sales.view");
  return db.crmAccount.findMany({
    where: {
      organizationId: ctx.orgId,
      status: "ACTIVE",
      // the caller's own-records limit AND any owner they ask for: asking for someone else's can only narrow, never widen
      AND: [ownerFilter(ctx), ...(f.ownerUserId ? [{ ownerUserId: f.ownerUserId }] : [])],
      ...(f.accountType ? { accountType: f.accountType as never } : {}),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { normalizedName: { contains: normalizeCompanyName(f.q) || f.q.toLowerCase() } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 500,
  });
}

export async function getAccount(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  return loadAccount(ctx, id, { allowVoid: true });
}

// ─────────────────────────────── Contacts ───────────────────────────────

export const contactSchema = z.object({
  accountId: text(60),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  jobTitle: text(),
  roleInDecision: z.enum(DECISION_ROLES).optional(),
  phone: text(40),
  whatsapp: text(40),
  email,
  isPrimary: z.boolean().optional(),
  ownerUserId: text(60),
});

async function loadContact(ctx: Ctx, id: string, opts: { allowVoid?: boolean } = {}) {
  const c = await db.crmContact.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) } });
  if (!c) throw new BusinessError("Contact not found.");
  if (c.status === "VOID" && !opts.allowVoid) throw new BusinessError("A voided contact cannot be changed.");
  return c;
}

/** The columns a contact's phones become (E.164). */
function contactPhones(v: { phone?: string; whatsapp?: string }) {
  return { ...(v.phone !== undefined ? { phoneE164: phoneOf("Phone number", v.phone) } : {}), ...(v.whatsapp !== undefined ? { whatsappE164: phoneOf("WhatsApp number", v.whatsapp) } : {}) };
}

export async function createContact(ctx: Ctx, raw: z.input<typeof contactSchema>) {
  await requireSales(ctx, "sales.manage");
  const v = contactSchema.parse(raw);
  const owner = await resolveOwner(ctx, v.ownerUserId);
  if (v.accountId) await loadAccount(ctx, v.accountId); // another organization's account (or one not visible) is "not found"
  const { phone: _p, whatsapp: _w, ownerUserId: _o, ...rest } = v;
  void [_p, _w, _o];
  const c = await db.crmContact.create({ data: { organizationId: ctx.orgId, ...rest, ...contactPhones(v), ...owner, createdBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_CONTACT_CREATE", entity: "CrmContact", entityId: c.id, newValue: { fields: fieldNames(v) } });
  return c;
}

export async function updateContact(ctx: Ctx, id: string, raw: Partial<z.input<typeof contactSchema>>) {
  await requireSales(ctx, "sales.manage");
  const before = await loadContact(ctx, id);
  const v = contactSchema.partial().parse(raw);
  const owner = v.ownerUserId !== undefined && v.ownerUserId !== before.ownerUserId ? await resolveOwner(ctx, v.ownerUserId) : undefined;
  if (v.accountId) await loadAccount(ctx, v.accountId);
  const { phone: _p, whatsapp: _w, ownerUserId: _o, ...rest } = v;
  void [_p, _w, _o];
  const c = await db.crmContact.update({ where: { id }, data: { ...rest, ...contactPhones(v), ...(owner ?? {}) } });
  await logAudit(ctx, { action: "SALES_CONTACT_UPDATE", entity: "CrmContact", entityId: id, newValue: { fields: fieldNames({ ...v, ...(owner ? { ownerUserId: 1 } : {}) }) } });
  return c;
}

export async function voidContact(ctx: Ctx, id: string, reason: string) {
  await requireSales(ctx, "sales.manage");
  await loadContact(ctx, id);
  if (!reason.trim()) throw new BusinessError("Say why the contact is being voided.");
  const c = await db.crmContact.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidedBy: ctx.name, voidReason: reason.trim() } });
  await logAudit(ctx, { action: "SALES_CONTACT_VOID", entity: "CrmContact", entityId: id });
  return c;
}

export async function listContacts(ctx: Ctx, f: { accountId?: string; q?: string } = {}) {
  await requireSales(ctx, "sales.view");
  return db.crmContact.findMany({
    where: {
      organizationId: ctx.orgId,
      status: "ACTIVE",
      ...ownerFilter(ctx),
      ...(f.accountId ? { accountId: f.accountId } : {}),
      ...(f.q ? { OR: [{ firstName: { contains: f.q, mode: "insensitive" } }, { lastName: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q.toLowerCase() } }] } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 500,
  });
}

// ─────────────────────────────── Leads ───────────────────────────────

export const leadSchema = z.object({
  companyName: z.string().trim().min(2, "The company's name is required").max(200),
  contactName: text(),
  jobTitle: text(),
  phone: text(40),
  email,
  industry: text(),
  state: text(60),
  lga: text(60),
  address: text(400),
  source: z.enum(SOURCES).optional(),
  sourceDetail: text(),
  estimatedGuards: z.coerce.number().int().min(0).max(100000).optional(),
  serviceInterest: z.enum(SERVICES).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED"]).optional(),
  unqualifiedReason: text(400),
  ownerUserId: text(60),
});

async function loadLead(ctx: Ctx, tx: Tx | typeof db, id: string, opts: { allowVoid?: boolean } = {}) {
  const l = await tx.crmLead.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) } });
  if (!l) throw new BusinessError("Lead not found.");
  if (l.status === "VOID" && !opts.allowVoid) throw new BusinessError("A voided lead cannot be changed.");
  if (l.status === "CONVERTED") throw new BusinessError("A converted lead is read-only: its details now live on the account, contact and opportunity it became.");
  return l;
}

export async function createLead(ctx: Ctx, raw: z.input<typeof leadSchema>) {
  await requireSales(ctx, "sales.manage");
  const v = leadSchema.parse(raw);
  if (v.status === "UNQUALIFIED" && !v.unqualifiedReason) throw new BusinessError("Say why the lead is unqualified.");
  const mode = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { mode: true } });
  if (mode?.mode === "SIMPLE") throw new BusinessError("In simple mode enquiries go straight to deals, so leads are not used: add a deal on an account instead.");
  const named = v.ownerUserId ? await resolveOwner(ctx, v.ownerUserId) : null;
  const { phone: _p, ownerUserId: _o, ...rest } = v;
  void [_p, _o];
  const phoneE164 = phoneOf("Phone number", v.phone);
  return db.$transaction(async (tx) => {
    // a manager who names no owner gets the organization's assignment method; a sales person always owns what they add
    const picked = !named && seesAll(ctx) ? await pickOwner(ctx, tx, { state: v.state, serviceInterest: v.serviceInterest ?? "OTHER" }) : null;
    const owner = named ?? (picked ? { ownerUserId: picked.ownerUserId, ownerName: picked.ownerName } : { ownerUserId: ctx.userId, ownerName: ctx.name });
    const number = await nextNumber(tx, ctx.orgId, "SALES_LEAD");
    const l = await tx.crmLead.create({
      data: { organizationId: ctx.orgId, number, ...rest, phoneE164, source: v.source ?? "OTHER", serviceInterest: v.serviceInterest ?? "OTHER", status: v.status ?? "NEW", ...owner, createdBy: ctx.name },
    });
    await logAudit(ctx, { action: "SALES_LEAD_CREATE", entity: "CrmLead", entityId: l.id, newValue: { number, fields: fieldNames(v) } }, tx);
    if (picked) await logAudit(ctx, { action: "SALES_LEAD_ASSIGN", entity: "CrmLead", entityId: l.id, newValue: { method: picked.via, ownerUserId: picked.ownerUserId } }, tx);
    return l;
  });
}

export async function updateLead(ctx: Ctx, id: string, raw: Partial<z.input<typeof leadSchema>>) {
  await requireSales(ctx, "sales.manage");
  const before = await loadLead(ctx, db, id);
  const v = leadSchema.partial().parse(raw);
  const status = v.status ?? before.status;
  if (status === "UNQUALIFIED" && !(v.unqualifiedReason ?? before.unqualifiedReason)) throw new BusinessError("Say why the lead is unqualified.");
  const owner = v.ownerUserId !== undefined && v.ownerUserId !== before.ownerUserId ? await resolveOwner(ctx, v.ownerUserId) : undefined;
  const { phone: _p, ownerUserId: _o, ...rest } = v;
  void [_p, _o];
  const l = await db.crmLead.update({ where: { id }, data: { ...rest, ...(v.phone !== undefined ? { phoneE164: phoneOf("Phone number", v.phone) } : {}), ...(owner ?? {}) } });
  await logAudit(ctx, { action: "SALES_LEAD_UPDATE", entity: "CrmLead", entityId: id, newValue: { fields: fieldNames({ ...v, ...(owner ? { ownerUserId: 1 } : {}) }) } });
  return l;
}

export async function voidLead(ctx: Ctx, id: string, reason: string) {
  await requireSales(ctx, "sales.manage");
  await loadLead(ctx, db, id);
  if (!reason.trim()) throw new BusinessError("Say why the lead is being voided.");
  const l = await db.crmLead.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidedBy: ctx.name, voidReason: reason.trim() } });
  await logAudit(ctx, { action: "SALES_LEAD_VOID", entity: "CrmLead", entityId: id });
  return l;
}

export async function listLeads(ctx: Ctx, f: { status?: string; ownerUserId?: string; source?: string; q?: string } = {}) {
  await requireSales(ctx, "sales.view");
  return db.crmLead.findMany({
    where: {
      organizationId: ctx.orgId,
      status: f.status ? (f.status as never) : { not: "VOID" },
      AND: [ownerFilter(ctx), ...(f.ownerUserId ? [{ ownerUserId: f.ownerUserId }] : [])],
      ...(f.source ? { source: f.source as never } : {}),
      ...(f.q ? { OR: [{ companyName: { contains: f.q, mode: "insensitive" } }, { contactName: { contains: f.q, mode: "insensitive" } }, { number: { contains: f.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

export async function getLead(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  const l = await db.crmLead.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) } });
  if (!l) throw new BusinessError("Lead not found.");
  return l;
}
