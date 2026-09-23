import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { can, ForbiddenError, type Permission } from "@/lib/auth/permissions";

export type Tx = Prisma.TransactionClient | PrismaClient;
export { db };

export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}

/** Defence in depth: services re-check permissions even when the caller already did. */
export function assertCan(ctx: Ctx, permission: Permission) {
  if (!can(ctx.role, permission)) throw new ForbiddenError(permission);
}

/** Every org-owned query goes through this to force tenancy scoping. */
export function org(ctx: Ctx) {
  return { organizationId: ctx.orgId };
}

export function toJson<T>(v: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
}
