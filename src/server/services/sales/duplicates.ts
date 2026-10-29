/**
 * Duplicate checks for the sales module. A check looks across the whole organization (a sales person must be told "someone already has this"),
 * but a match owned by someone else is reported only as "a matching record exists, owned by <name>", never with the company, phone or email, so the
 * check cannot be used to read other people's records.
 */
import type { Ctx } from "@/lib/auth/context";
import { accountMatches, businessEmailDomain, personMatches } from "@/lib/sales/duplicates";
import { normalizeCompanyName } from "@/lib/sales/names";
import { normalizeNgPhone } from "@/lib/sales/phone";
import { db } from "../_base";
import { requireSales, seesAll } from "./access";

export type VisibleMatch = { kind: "ACCOUNT" | "LEAD" | "CONTACT"; id: string; label: string; reason: string; ownerName: string };
export type HiddenMatch = { ownerName: string; reason: string };
export type DuplicateReport = { visible: VisibleMatch[]; hidden: HiddenMatch[] };

const canSee = (ctx: Ctx, ownerUserId: string) => seesAll(ctx) || ownerUserId === ctx.userId;

export async function findAccountDuplicates(ctx: Ctx, candidate: { name: string; rcNumber?: string; emailDomain?: string; email?: string }, excludeId?: string): Promise<DuplicateReport> {
  await requireSales(ctx, "sales.view");
  const existing = await db.crmAccount.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true, normalizedName: true, rcNumber: true, emailDomain: true, ownerUserId: true, ownerName: true } });
  const matches = accountMatches({ name: candidate.name, normalizedName: normalizeCompanyName(candidate.name), rcNumber: candidate.rcNumber, emailDomain: candidate.emailDomain ?? businessEmailDomain(candidate.email) }, existing);
  const byId = new Map(existing.map((e) => [e.id, e]));
  const report: DuplicateReport = { visible: [], hidden: [] };
  for (const m of matches) {
    const e = byId.get(m.id)!;
    if (canSee(ctx, e.ownerUserId)) report.visible.push({ kind: "ACCOUNT", id: e.id, label: e.name, reason: m.reason, ownerName: e.ownerName });
    else report.hidden.push({ ownerName: e.ownerName, reason: m.reason });
  }
  return report;
}

/** Leads (not voided or converted) and contacts that share the phone or email. */
export async function findPersonDuplicates(ctx: Ctx, candidate: { phone?: string; email?: string }, excludeId?: string): Promise<DuplicateReport> {
  await requireSales(ctx, "sales.view");
  const phone = candidate.phone ? normalizeNgPhone(candidate.phone) : null;
  const phoneE164 = phone?.ok ? phone.e164 : undefined;
  const email = candidate.email?.trim().toLowerCase() || undefined;
  const report: DuplicateReport = { visible: [], hidden: [] };
  if (!phoneE164 && !email) return report;
  const or = [...(phoneE164 ? [{ phoneE164 }] : []), ...(email ? [{ email }] : [])];
  const [leads, contacts] = await Promise.all([
    db.crmLead.findMany({ where: { organizationId: ctx.orgId, status: { notIn: ["VOID", "CONVERTED"] }, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, companyName: true, contactName: true, phoneE164: true, email: true, ownerUserId: true, ownerName: true } }),
    db.crmContact.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, firstName: true, lastName: true, phoneE164: true, email: true, ownerUserId: true, ownerName: true } }),
  ]);
  const rows = [
    ...leads.map((l) => ({ kind: "LEAD" as const, id: l.id, label: l.contactName ? `${l.contactName} (${l.companyName})` : l.companyName, phoneE164: l.phoneE164, email: l.email, ownerUserId: l.ownerUserId, ownerName: l.ownerName })),
    ...contacts.map((c) => ({ kind: "CONTACT" as const, id: c.id, label: `${c.firstName} ${c.lastName}`, phoneE164: c.phoneE164, email: c.email, ownerUserId: c.ownerUserId, ownerName: c.ownerName })),
  ];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const m of personMatches({ phoneE164, email }, rows)) {
    const r = byId.get(m.id)!;
    if (canSee(ctx, r.ownerUserId)) report.visible.push({ kind: r.kind, id: r.id, label: r.label, reason: m.reason, ownerName: r.ownerName });
    else report.hidden.push({ ownerName: r.ownerName, reason: m.reason });
  }
  return report;
}
