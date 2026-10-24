/**
 * The bureau layer: a payroll bureau (ThreeRoots) serves client organizations. Each client is its own organization, so its employees, pay
 * rules and payroll are isolated from every other client's by construction. Bureau staff work in the clients they have been given
 * (bureau managers in all of them), by switching organization; everything they do there is audited in the client's own log, under
 * their own name.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { mayWorkIn } from "@/lib/auth/bureau-access";
import { can } from "@/lib/auth/permissions";
import { d } from "@/lib/dates";
import { num } from "@/lib/money";
import { ensureDefaultChart } from "./accounting";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { copyStatutoryRules } from "./statutory";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

/** The bureau organization the signed-in person works for, whichever client they are currently working in. */
export const bureauOrgId = (ctx: Ctx) => ctx.homeOrgId ?? ctx.orgId;

async function loadBureau(ctx: Ctx) {
  const org = await db.organization.findUnique({ where: { id: bureauOrgId(ctx) } });
  if (!org) throw new BusinessError("Organization not found.");
  return org;
}

async function requireBureau(ctx: Ctx) {
  const org = await loadBureau(ctx);
  if (!org.isBureau) throw new BusinessError("This organization is not set up as a payroll bureau.");
  return org;
}

/** Makes the signed-in person's organization a payroll bureau, so it can onboard clients. */
export async function enableBureau(ctx: Ctx) {
  assertCan(ctx, "bureau.manage");
  const org = await loadBureau(ctx);
  if (org.bureauOrganizationId) throw new BusinessError("A client organization cannot also be a bureau.");
  if (org.isBureau) throw new BusinessError("This organization is already a bureau.");
  await db.organization.update({ where: { id: org.id }, data: { isBureau: true } });
  await logAudit({ ...ctx, orgId: org.id }, { action: "BUREAU_ENABLE", entity: "Organization", entityId: org.id });
}

// ─────────────────────────────── Clients ───────────────────────────────

export const PACKAGES = ["PAYROLL_ESSENTIALS", "PAYROLL_COMPLIANCE", "MANAGED_PAYROLL_PLUS", "ENTERPRISE", "HEALTH_CHECK"] as const;
export const PACKAGE_LABELS: Record<(typeof PACKAGES)[number], string> = {
  PAYROLL_ESSENTIALS: "Payroll Essentials",
  PAYROLL_COMPLIANCE: "Payroll & Compliance",
  MANAGED_PAYROLL_PLUS: "Managed Payroll Plus",
  ENTERPRISE: "Enterprise",
  HEALTH_CHECK: "Payroll Health Check",
};

const money = z.coerce.number().min(0).default(0);
export const engagementTermsSchema = z.object({
  package: z.enum(PACKAGES),
  startDate: z.string().min(10, "Start date is required"),
  termMonths: z.coerce.number().refine((n) => n === 6 || n === 12, "The term is 6 or 12 months"),
  perEmployeeRate: money,
  monthlyMinimum: money,
  onboardingFee: money,
  addOns: opt,
  contactName: opt,
  contactEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  contactPhone: opt,
  slaTerms: opt,
  dpaReference: opt,
  dpaSignedAt: opt,
  notes: opt,
});

export const onboardClientSchema = engagementTermsSchema.extend({
  name: z.string().trim().min(2, "The client's name is required"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,12}$/, "The short code is 2 to 12 letters or digits"),
});

/**
 * Creates a client: its own organization (with the bureau's statutory rule tables copied in and a standard chart of accounts) and its
 * engagement terms. Nobody has access until they are given it, except bureau managers.
 */
export async function onboardClient(ctx: Ctx, raw: z.input<typeof onboardClientSchema>) {
  assertCan(ctx, "bureau.manage");
  const bureau = await requireBureau(ctx);
  const v = onboardClientSchema.parse(raw);
  if (await db.organization.findUnique({ where: { code: v.code } })) throw new BusinessError(`The code ${v.code} is already in use.`);
  return db.$transaction(
    async (tx) => {
      const client = await tx.organization.create({ data: { name: v.name, code: v.code, bureauOrganizationId: bureau.id, currency: bureau.currency } });
      const rules = await copyStatutoryRules(tx, bureau.id, client.id);
      await ensureDefaultChart(tx, client.id);
      const engagement = await tx.clientEngagement.create({
        data: {
          bureauOrganizationId: bureau.id,
          clientOrganizationId: client.id,
          package: v.package,
          startDate: d(v.startDate),
          termMonths: v.termMonths,
          perEmployeeRate: v.perEmployeeRate,
          monthlyMinimum: v.monthlyMinimum,
          onboardingFee: v.onboardingFee,
          addOns: v.addOns ?? null,
          contactName: v.contactName ?? null,
          contactEmail: v.contactEmail ?? null,
          contactPhone: v.contactPhone ?? null,
          slaTerms: v.slaTerms ?? null,
          dpaReference: v.dpaReference ?? null,
          dpaSignedAt: v.dpaSignedAt ? d(v.dpaSignedAt) : null,
          notes: v.notes ?? null,
          createdBy: ctx.name,
        },
      });
      await logAudit({ ...ctx, orgId: bureau.id }, { action: "CLIENT_ONBOARD", entity: "ClientEngagement", entityId: engagement.id, newValue: { client: v.name, code: v.code, package: v.package, rules } }, tx);
      await logAudit({ ...ctx, orgId: client.id }, { action: "ORGANIZATION_CREATED", entity: "Organization", entityId: client.id, newValue: { createdBy: ctx.name, bureau: bureau.name, rules } }, tx);
      return { client, engagement, rules };
    },
    { timeout: 60_000 },
  );
}

/** The clients this person may work in, with their terms, headcount and latest payroll. */
export async function listClients(ctx: Ctx) {
  assertCan(ctx, "bureau.view");
  const bureau = await loadBureau(ctx);
  if (!bureau.isBureau) return { bureau, clients: [] };
  const where = can(ctx.role, "bureau.manage")
    ? { bureauOrganizationId: bureau.id }
    : { bureauOrganizationId: bureau.id, staffAccessAsClient: { some: { userId: ctx.userId } } };
  const orgs = await db.organization.findMany({ where, include: { engagement: true }, orderBy: { name: "asc" } });
  const ids = orgs.map((o) => o.id);
  const [heads, runs] = await Promise.all([
    db.employee.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] } }, _count: true }),
    db.payrollRun.findMany({
      where: { organizationId: { in: ids }, type: "REGULAR" },
      orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }],
      select: { organizationId: true, status: true, period: { select: { name: true } } },
    }),
  ]);
  const headBy = new Map(heads.map((h) => [h.organizationId, h._count]));
  const latest = new Map<string, { status: string; period: string }>();
  for (const r of runs) if (!latest.has(r.organizationId)) latest.set(r.organizationId, { status: r.status, period: r.period.name });
  return {
    bureau,
    clients: orgs.map((o) => ({ org: o, engagement: o.engagement, headcount: headBy.get(o.id) ?? 0, latestRun: latest.get(o.id) ?? null })),
  };
}

export async function getClient(ctx: Ctx, clientOrgId: string) {
  assertCan(ctx, "bureau.view");
  const bureau = await requireBureau(ctx);
  const org = await db.organization.findFirst({ where: { id: clientOrgId, bureauOrganizationId: bureau.id }, include: { engagement: true } });
  if (!org) throw new BusinessError("Client not found.");
  if (!(await mayWorkIn({ id: ctx.userId, organizationId: bureau.id, role: ctx.role }, org.id))) throw new BusinessError("You have not been given access to this client.");
  const [access, headcount] = await Promise.all([
    db.staffClientAccess.findMany({ where: { clientOrganizationId: org.id }, include: { user: { select: { id: true, name: true, role: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.employee.count({ where: { organizationId: org.id, status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] } } }),
  ]);
  return { org, engagement: org.engagement, access, headcount };
}

export const engagementUpdateSchema = engagementTermsSchema.extend({
  status: z.enum(["ONBOARDING", "ACTIVE", "PAUSED", "ENDED"]),
});

export async function updateEngagement(ctx: Ctx, clientOrgId: string, raw: z.input<typeof engagementUpdateSchema>) {
  assertCan(ctx, "bureau.manage");
  const bureau = await requireBureau(ctx);
  const v = engagementUpdateSchema.parse(raw);
  const eng = await db.clientEngagement.findFirst({ where: { clientOrganizationId: clientOrgId, bureauOrganizationId: bureau.id } });
  if (!eng) throw new BusinessError("Client not found.");
  if (eng.status === "ENDED" && v.status !== "ENDED") throw new BusinessError("An ended engagement is not reopened. Onboard the client again if they return.");
  const updated = await db.clientEngagement.update({
    where: { id: eng.id },
    data: {
      package: v.package,
      status: v.status,
      startDate: d(v.startDate),
      termMonths: v.termMonths,
      perEmployeeRate: v.perEmployeeRate,
      monthlyMinimum: v.monthlyMinimum,
      onboardingFee: v.onboardingFee,
      addOns: v.addOns ?? null,
      contactName: v.contactName ?? null,
      contactEmail: v.contactEmail ?? null,
      contactPhone: v.contactPhone ?? null,
      slaTerms: v.slaTerms ?? null,
      dpaReference: v.dpaReference ?? null,
      dpaSignedAt: v.dpaSignedAt ? d(v.dpaSignedAt) : null,
      notes: v.notes ?? null,
    },
  });
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "CLIENT_ENGAGEMENT_UPDATE", entity: "ClientEngagement", entityId: eng.id, oldValue: { status: eng.status, package: eng.package, perEmployeeRate: num(eng.perEmployeeRate) }, newValue: { status: updated.status, package: updated.package, perEmployeeRate: num(updated.perEmployeeRate) } });
  return updated;
}

// ─────────────────────────────── Staff access ───────────────────────────────

export async function bureauStaff(ctx: Ctx) {
  assertCan(ctx, "bureau.manage");
  const bureau = await requireBureau(ctx);
  return db.user.findMany({ where: { organizationId: bureau.id, active: true }, select: { id: true, name: true, role: true, email: true }, orderBy: { name: "asc" } });
}

export async function grantAccess(ctx: Ctx, userId: string, clientOrgId: string) {
  assertCan(ctx, "bureau.manage");
  const bureau = await requireBureau(ctx);
  const user = await db.user.findFirst({ where: { id: userId, organizationId: bureau.id, active: true } });
  if (!user) throw new BusinessError("Staff member not found.");
  const client = await db.organization.findFirst({ where: { id: clientOrgId, bureauOrganizationId: bureau.id } });
  if (!client) throw new BusinessError("Client not found.");
  if (!can(user.role, "bureau.view")) throw new BusinessError(`${user.name}'s role (${user.role.replace("_", " ").toLowerCase()}) does not include working in clients.`);
  if (await db.staffClientAccess.findUnique({ where: { userId_clientOrganizationId: { userId, clientOrganizationId: clientOrgId } } })) throw new BusinessError(`${user.name} already has access to ${client.name}.`);
  await db.staffClientAccess.create({ data: { bureauOrganizationId: bureau.id, userId, clientOrganizationId: clientOrgId, grantedBy: ctx.name, grantedByUserId: ctx.userId } });
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "CLIENT_ACCESS_GRANT", entity: "StaffClientAccess", entityId: userId, newValue: { staff: user.name, client: client.name } });
  await logAudit({ ...ctx, orgId: client.id }, { action: "CLIENT_ACCESS_GRANT", entity: "StaffClientAccess", entityId: userId, newValue: { staff: user.name, grantedBy: ctx.name } });
}

export async function revokeAccess(ctx: Ctx, userId: string, clientOrgId: string) {
  assertCan(ctx, "bureau.manage");
  const bureau = await requireBureau(ctx);
  const grant = await db.staffClientAccess.findFirst({ where: { userId, clientOrganizationId: clientOrgId, bureauOrganizationId: bureau.id }, include: { user: { select: { name: true } }, client: { select: { name: true } } } });
  if (!grant) throw new BusinessError("That access is not in place.");
  await db.staffClientAccess.delete({ where: { id: grant.id } });
  await logAudit({ ...ctx, orgId: bureau.id }, { action: "CLIENT_ACCESS_REVOKE", entity: "StaffClientAccess", entityId: userId, oldValue: { staff: grant.user.name, client: grant.client.name } });
  await logAudit({ ...ctx, orgId: clientOrgId }, { action: "CLIENT_ACCESS_REVOKE", entity: "StaffClientAccess", entityId: userId, oldValue: { staff: grant.user.name, revokedBy: ctx.name } });
}

/** Whether the person may now switch into this organization (their own, or a client they have access to). */
export async function canSwitchTo(ctx: Ctx, targetOrgId: string): Promise<boolean> {
  const me = await db.user.findUnique({ where: { id: ctx.userId }, select: { id: true, organizationId: true, role: true, active: true } });
  if (!me || !me.active) return false;
  return mayWorkIn({ id: me.id, organizationId: me.organizationId, role: me.role }, targetOrgId);
}
