import type { Ctx } from "@/lib/auth/context";
import { db, toJson, type Tx } from "./_base";

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

export async function logAudit(ctx: Ctx, entry: AuditEntry, tx: Tx = db) {
  await tx.auditLog.create({
    data: {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      userName: ctx.name,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      oldValue: entry.oldValue === undefined ? undefined : toJson(entry.oldValue),
      newValue: entry.newValue === undefined ? undefined : toJson(entry.newValue),
      reason: entry.reason ?? null,
      metadata: toJson({ role: ctx.role, ip: ctx.ip ?? null }),
    },
  });
}

export async function listAudit(
  ctx: Ctx,
  filter: { entity?: string; action?: string; q?: string; take?: number } = {},
) {
  return db.auditLog.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(filter.entity ? { entity: filter.entity } : {}),
      ...(filter.action ? { action: { contains: filter.action, mode: "insensitive" } } : {}),
      ...(filter.q
        ? {
            OR: [
              { userName: { contains: filter.q, mode: "insensitive" } },
              { entityId: { contains: filter.q } },
              { reason: { contains: filter.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filter.take ?? 300,
  });
}
