/**
 * Where the module decision (src/lib/entitlements/guard.ts) is applied to a request: a page, a server action or an API route (step E3a of docs/plans/module-entitlements-e3.md).
 * Each reads `ctx.entitlements`, which nothing sets yet, so today none of them refuses or reports anything. An entry that is still only a guess is held to the core.
 */
import { NextResponse } from "next/server";
import type { Ctx } from "@/lib/auth/context";
import { effectiveModule, type EntryKind } from "@/lib/entitlements/entry-modules";
import { decide, pageRouteFor, type Decision } from "@/lib/entitlements/guard";
import { logger } from "@/lib/logger";
import { BusinessError } from "./_base";

export class ModuleNotBoughtError extends BusinessError {
  constructor(message: string) {
    super(message);
    this.name = "ModuleNotBoughtError";
  }
}

/** The decision for an entry, with a log line (module, kind, entry and company only, nothing personal) when it is allowed only because the module is in REPORT mode. */
export function entryDecision(ctx: Ctx, kind: EntryKind, key: string): Decision {
  if (!ctx.entitlements) return { allow: true, report: false, module: "core" };
  const d = decide(ctx.entitlements, effectiveModule(kind, key));
  if (d.report) logger.warn("entitlement_would_refuse", { module: d.module, kind, entry: key, organizationId: ctx.orgId });
  return d;
}

/** A server action: throws, with the plain message, when its module is enforced and not bought. */
export function assertEntry(ctx: Ctx, kind: EntryKind, key: string) {
  const d = entryDecision(ctx, kind, key);
  if (!d.allow) throw new ModuleNotBoughtError(d.message!);
}

/** A page: where to send the person instead, or null. `address` is the path the request was for. */
export function pageRefusal(ctx: Ctx, address: string | null): string | null {
  if (!ctx.entitlements || !address) return null;
  const route = pageRouteFor(address);
  if (!route) return null;
  const d = entryDecision(ctx, "page", route);
  return d.allow ? null : `/forbidden?module=${d.module}`;
}

/** An API route: the response to return instead, or null. */
export function routeRefusal(ctx: Ctx, route: string): NextResponse | null {
  const d = entryDecision(ctx, "api", route);
  return d.allow ? null : NextResponse.json({ error: d.message }, { status: 403 });
}
