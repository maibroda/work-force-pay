import "server-only";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { requireAction } from "@/lib/auth/session";
import { ForbiddenError, type Permission } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/auth/context";
import { BusinessError } from "@/server/services/_base";
import { logger } from "@/lib/logger";

/** Wraps a server action: authorization, error → friendly message, revalidation. */
export async function act(
  permission: Permission,
  fn: (ctx: Ctx) => Promise<Partial<ActionResult> | void>,
  revalidate: string[] = [],
): Promise<ActionResult> {
  try {
    const ctx = await requireAction(permission);
    const r = (await fn(ctx)) ?? {};
    for (const p of revalidate) revalidatePath(p, "layout");
    return { ok: true, message: "Saved.", ...r };
  } catch (e) {
    if (e instanceof ZodError)
      return {
        ok: false,
        error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
      };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { ok: false, error: "A record with the same unique value already exists." };
    // Expected, user-facing errors (business rules / permission checks) — safe to show as-is.
    if (e instanceof BusinessError || e instanceof ForbiddenError) {
      return { ok: false, error: e.message };
    }
    // Anything else is unexpected — log/report it in full, but never leak internals to the user.
    logger.error("server_action_failed", { permission, error: e });
    Sentry.captureException(e, { tags: { permission } });
    return { ok: false, error: "Something went wrong. This has been logged for investigation." };
  }
}

export const s = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
