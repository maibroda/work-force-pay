import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { exportLimiter } from "@/lib/rate-limit";
import { limitedResponse } from "@/lib/rate-limit-http";
import { BusinessError } from "@/server/services/_base";
import { exportSubject } from "@/server/services/sales/privacy";
import { routeRefusal } from "@/server/services/entitlement-guard";

export const dynamic = "force-dynamic";

/** Everything held about the person a data request is about, as a JSON file. Only the company administrator, only once identity is checked; every download is recorded. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  const off = routeRefusal(ctx, "/api/sales/privacy/[id]");
  if (off) return off;
  if (!can(ctx.role, "sales.privacy.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const slow = limitedResponse(exportLimiter, ctx.userId);
  if (slow) return slow;
  try {
    const f = await exportSubject(ctx, id);
    return new NextResponse(f.json, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${f.fileName}"`, "Cache-Control": "no-store", "X-Checksum-SHA256": f.checksum },
    });
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
