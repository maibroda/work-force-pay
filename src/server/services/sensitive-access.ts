/**
 * The record of who looked at people's sensitive details. Writing it is part of showing them: each page that shows bank, tax or pension
 * identifiers, guarantors or next of kin, a payslip or a payment file calls `recordSensitiveAccess` before it renders. The entries go in the
 * organization's own audit log under the person's own name (and, for bureau staff working in a client, tagged with the bureau).
 */
import type { Ctx } from "@/lib/auth/context";
import { ACCESS_KINDS, DEDUPE_MINUTES, summariseAccess, type AccessKind } from "@/lib/sensitive-access";
import { assertCan, db } from "./_base";
import { logAudit } from "./audit";

export const SENSITIVE_VIEW = "SENSITIVE_VIEW";

export interface AccessTarget {
  kind: AccessKind;
  /** One person's details; leave out for a list, report or file. */
  employeeId?: string;
  /** For something that isn't a person: the report type, payroll run, or page. */
  ref?: string;
  /** How many people's details were on the page. */
  count?: number;
  now?: Date;
}

/**
 * Notes that the signed-in person opened this. Looking at your own record isn't recorded, and opening the same thing again within a few
 * minutes is one entry. Not recording is not an option: if this fails, so does the page.
 */
export async function recordSensitiveAccess(ctx: Ctx, t: AccessTarget): Promise<void> {
  if (t.employeeId && t.employeeId === ctx.employeeId) return;
  const entity = t.employeeId ? "Employee" : "SensitiveList";
  const entityId = t.employeeId ?? t.ref ?? null;
  const since = new Date((t.now ?? new Date()).getTime() - DEDUPE_MINUTES * 60_000);
  const recent = await db.auditLog.findFirst({
    where: { organizationId: ctx.orgId, userId: ctx.userId, action: SENSITIVE_VIEW, entity, entityId, createdAt: { gte: since }, newValue: { path: ["kind"], equals: t.kind } },
    select: { id: true },
  });
  if (recent) return;
  await logAudit(ctx, { action: SENSITIVE_VIEW, entity, entityId, newValue: { kind: t.kind, ...(t.count !== undefined ? { count: t.count } : {}) } });
}

/** Who looked at what over the last `days` days, newest first, with a summary per person. For auditors and administrators. */
export async function sensitiveAccessLog(ctx: Ctx, f: { days?: number; userId?: string; kind?: string } = {}) {
  assertCan(ctx, "audit.view");
  const days = f.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const kind = (ACCESS_KINDS as readonly string[]).includes(f.kind ?? "") ? (f.kind as AccessKind) : undefined;
  const rows = await db.auditLog.findMany({
    where: {
      organizationId: ctx.orgId,
      action: SENSITIVE_VIEW,
      createdAt: { gte: since },
      ...(f.userId ? { userId: f.userId } : {}),
      ...(kind ? { newValue: { path: ["kind"], equals: kind } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const employeeIds = [...new Set(rows.filter((r) => r.entity === "Employee" && r.entityId).map((r) => r.entityId!))];
  const people = employeeIds.length
    ? await db.employee.findMany({ where: { id: { in: employeeIds }, organizationId: ctx.orgId }, select: { id: true, employeeNumber: true, firstName: true, lastName: true } })
    : [];
  const names = new Map(people.map((p) => [p.id, `${p.employeeNumber} ${p.firstName} ${p.lastName}`]));
  const entries = rows.map((r) => {
    const v = (r.newValue ?? {}) as { kind?: AccessKind; count?: number };
    const bureau = (r.metadata as { bureau?: string } | null)?.bureau ?? null;
    return {
      id: r.id,
      at: r.createdAt,
      userId: r.userId,
      userName: r.userName,
      kind: (v.kind ?? "IDENTIFIERS") as AccessKind,
      employeeId: r.entity === "Employee" ? r.entityId : null,
      employee: r.entity === "Employee" && r.entityId ? names.get(r.entityId) ?? "Removed employee" : null,
      ref: r.entity === "SensitiveList" ? r.entityId : null,
      count: v.count ?? null,
      fromBureau: !!bureau,
    };
  });
  const summary = summariseAccess(entries.map((e) => ({ userId: e.userId, userName: e.userName, employeeId: e.employeeId, kind: e.kind, at: e.at })));
  return { days, entries, summary, truncated: rows.length === 1000 };
}
