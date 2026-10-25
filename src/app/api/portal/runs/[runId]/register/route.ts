import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { ForbiddenError } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { portalRegisterCsv } from "@/server/services/payslips";

export const dynamic = "force-dynamic";

/** The client's payroll register as a CSV, once the payroll is approved. Audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required. Set it up under My security." }, { status: 403 });
  try {
    const f = await portalRegisterCsv(ctx, runId);
    return new NextResponse(f.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${f.fileName}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
