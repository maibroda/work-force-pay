/**
 * Importing leads, accounts and contacts from a CSV. Preview first (every row checked, nothing saved, rows that look like records already held are
 * flagged), then an explicit import in one transaction. Rows with errors are never imported; rows that look like something already held are skipped
 * unless the person says to import them anyway. Leads imported by a manager follow the organization's owner-assignment method; anyone else owns what they
 * import. A match owned by someone else is described only by its owner. Consent is recorded only where the file states it and its source. Audited as a
 * summary (counts), never row by row.
 */
import type { Ctx } from "@/lib/auth/context";
import { accountMatches, personMatches } from "@/lib/sales/duplicates";
import { checkImport, IMPORT_KINDS, type ImportCheck, type ImportKind, type ImportRow } from "@/lib/sales/import";
import { normalizeCompanyName } from "@/lib/sales/names";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { nextNumber } from "../numbering";
import { ownerFilter, requireSales, seesAll } from "./access";
import { pickOwner } from "./assignment";

export type RowDuplicates = { visible: string[]; hidden: number };
export type ImportPreview = { check: ImportCheck; duplicates: Record<number, RowDuplicates> };

const canSee = (ctx: Ctx, ownerUserId: string) => seesAll(ctx) || ownerUserId === ctx.userId;

function assertKind(kind: string): asserts kind is ImportKind {
  if (!(IMPORT_KINDS as string[]).includes(kind)) throw new BusinessError("Choose what is being imported: leads, accounts or contacts.");
}

/** Checks the file and flags rows that look like records already held. Saves nothing. */
export async function previewImport(ctx: Ctx, kind: ImportKind, csv: string): Promise<ImportPreview> {
  await requireSales(ctx, "sales.manage");
  assertKind(kind);
  const check = checkImport(kind, csv);
  const duplicates: Record<number, RowDuplicates> = {};
  if (check.fatal) return { check, duplicates };
  const valid = check.rows.filter((r): r is ImportRow & { data: Record<string, unknown> } => !!r.data);

  if (kind === "ACCOUNTS") {
    const existing = await db.crmAccount.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, select: { id: true, name: true, normalizedName: true, rcNumber: true, emailDomain: true, ownerUserId: true, ownerName: true } });
    const byId = new Map(existing.map((e) => [e.id, e]));
    for (const r of valid) {
      const hits = accountMatches({ name: String(r.data.name), normalizedName: normalizeCompanyName(String(r.data.name)), rcNumber: r.data.rcNumber as string | undefined, emailDomain: r.data.emailDomain as string | undefined }, existing);
      if (hits.length) duplicates[r.line] = split(ctx, hits.map((h) => ({ ...h, owner: byId.get(h.id)!, label: byId.get(h.id)!.name })));
    }
  } else {
    const [leads, contacts] = await Promise.all([
      db.crmLead.findMany({ where: { organizationId: ctx.orgId, status: { notIn: ["VOID", "CONVERTED"] } }, select: { id: true, companyName: true, phoneE164: true, email: true, ownerUserId: true, ownerName: true } }),
      db.crmContact.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, phoneE164: true, email: true, ownerUserId: true, ownerName: true } }),
    ]);
    const people = [
      ...leads.map((l) => ({ id: l.id, phoneE164: l.phoneE164, email: l.email, owner: l, label: l.companyName })),
      ...contacts.map((c) => ({ id: c.id, phoneE164: c.phoneE164, email: c.email, owner: c, label: `${c.firstName} ${c.lastName}` })),
    ];
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const r of valid) {
      const hits = personMatches({ phoneE164: r.data.phoneE164 as string | undefined, email: r.data.email as string | undefined }, people);
      if (hits.length) duplicates[r.line] = split(ctx, hits.map((h) => ({ ...h, owner: byId.get(h.id)!.owner, label: byId.get(h.id)!.label })));
    }
  }

  if (kind === "CONTACTS") {
    // a contact is attached to an account by the account's name; the account must already exist (and be one the importer may see)
    const accounts = await db.crmAccount.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", ...ownerFilter(ctx) }, select: { id: true, normalizedName: true } });
    for (const r of check.rows) {
      const d = r.data;
      if (!d || !d.accountName) continue;
      const found = accounts.filter((a) => a.normalizedName === normalizeCompanyName(String(d.accountName)));
      if (found.length === 1) d.accountId = found[0].id;
      else {
        r.errors.push(found.length ? `More than one account is called "${d.accountName}": merge them first or use the exact name.` : `No account called "${d.accountName}" that you can see: add it first (import accounts before contacts).`);
        r.data = undefined;
      }
    }
    const errors = check.rows.filter((r) => r.errors.length).length;
    const warnings = check.rows.filter((r) => !r.errors.length && r.warnings.length).length;
    check.summary = { total: check.rows.length, ok: check.rows.length - errors - warnings, warnings, errors };
  }
  return { check, duplicates };
}

function split(ctx: Ctx, hits: Array<{ reason: string; owner: { ownerUserId: string; ownerName: string }; label: string }>): RowDuplicates {
  const out: RowDuplicates = { visible: [], hidden: 0 };
  for (const h of hits) {
    if (canSee(ctx, h.owner.ownerUserId)) out.visible.push(`${h.label} (${h.reason.toLowerCase()}, owner ${h.owner.ownerName})`);
    else out.hidden += 1;
  }
  return out;
}

export interface CommitOptions {
  /** Import the rows without errors and leave the others out (otherwise any error stops the import). */
  skipErrors?: boolean;
  /** Import rows that look like something already held (otherwise they are left out). */
  importDuplicates?: boolean;
}

export async function commitImport(ctx: Ctx, kind: ImportKind, csv: string, opts: CommitOptions = {}) {
  await requireSales(ctx, "sales.manage");
  assertKind(kind);
  const { check, duplicates } = await previewImport(ctx, kind, csv);
  if (check.fatal) throw new BusinessError(check.fatal);
  if (check.summary.errors > 0 && !opts.skipErrors) throw new BusinessError(`${check.summary.errors} row(s) have errors. Correct the file, or choose to import only the rows without errors.`);
  const clean = check.rows.filter((r) => r.data);
  const isDup = (r: ImportRow) => !!duplicates[r.line] && (duplicates[r.line].visible.length > 0 || duplicates[r.line].hidden > 0);
  const toImport = clean.filter((r) => opts.importDuplicates || !isDup(r));
  const skippedDuplicates = clean.length - toImport.length;
  if (!toImport.length) throw new BusinessError(skippedDuplicates ? "Every row without an error looks like something already held, so nothing was imported. Tick 'import anyway' if they really are new." : "There is nothing to import.");

  const created = await db.$transaction(async (tx: Tx) => {
    let n = 0;
    for (const r of toImport) {
      const d = r.data!;
      const consent = d.consent as { status: "GRANTED" | "WITHDRAWN"; source: string } | undefined;
      const noteConsent = async (target: { contactId?: string; leadId?: string }) => {
        if (consent) await tx.crmConsent.create({ data: { organizationId: ctx.orgId, ...target, purpose: "MARKETING", status: consent.status, channel: "OTHER", source: `Import: ${consent.source}`, recordedBy: ctx.name, recordedByUserId: ctx.userId } });
      };
      if (kind === "LEADS") {
        const picked = seesAll(ctx) ? await pickOwner(ctx, tx, { state: d.state as string | undefined, serviceInterest: (d.serviceInterest as string | undefined) ?? "OTHER" }) : null;
        const owner = picked ? { ownerUserId: picked.ownerUserId, ownerName: picked.ownerName } : { ownerUserId: ctx.userId, ownerName: ctx.name };
        const number = await nextNumber(tx, ctx.orgId, "SALES_LEAD");
        const l = await tx.crmLead.create({
          data: {
            organizationId: ctx.orgId, number, companyName: String(d.companyName), contactName: d.contactName as string | undefined, jobTitle: d.jobTitle as string | undefined, phoneE164: d.phoneE164 as string | undefined, email: d.email as string | undefined,
            industry: d.industry as string | undefined, state: d.state as string | undefined, lga: d.lga as string | undefined, address: d.address as string | undefined, source: (d.source as never) ?? "OTHER", sourceDetail: d.sourceDetail as string | undefined,
            estimatedGuards: d.estimatedGuards as number | undefined, serviceInterest: (d.serviceInterest as never) ?? "OTHER", ...owner, createdBy: ctx.name,
          },
        });
        await noteConsent({ leadId: l.id });
      } else if (kind === "ACCOUNTS") {
        await tx.crmAccount.create({
          data: {
            organizationId: ctx.orgId, name: String(d.name), normalizedName: normalizeCompanyName(String(d.name)), industry: d.industry as string | undefined, accountType: (d.accountType as never) ?? "PROSPECT", ownerUserId: ctx.userId, ownerName: ctx.name,
            source: d.source as never, sourceDetail: d.sourceDetail as string | undefined, state: d.state as string | undefined, lga: d.lga as string | undefined, address: d.address as string | undefined, rcNumber: d.rcNumber as string | undefined,
            emailDomain: d.emailDomain as string | undefined, createdBy: ctx.name,
          },
        });
      } else {
        const c = await tx.crmContact.create({
          data: {
            organizationId: ctx.orgId, accountId: d.accountId as string | undefined, firstName: String(d.firstName), lastName: String(d.lastName), jobTitle: d.jobTitle as string | undefined, roleInDecision: d.roleInDecision as never,
            phoneE164: d.phoneE164 as string | undefined, whatsappE164: d.whatsappE164 as string | undefined, email: d.email as string | undefined, ownerUserId: ctx.userId, ownerName: ctx.name, createdBy: ctx.name,
          },
        });
        await noteConsent({ contactId: c.id });
      }
      n += 1;
    }
    await logAudit(ctx, { action: "SALES_IMPORT", entity: "CrmImport", entityId: kind, newValue: { kind, imported: n, skippedErrors: check.summary.errors, skippedDuplicates, importedDuplicates: !!opts.importDuplicates } }, tx);
    return n;
  });
  return { created, skippedErrors: check.summary.errors, skippedDuplicates };
}
