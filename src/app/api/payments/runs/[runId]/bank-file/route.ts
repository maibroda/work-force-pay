import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { exportPaymentFile } from "@/server/services/payment-file";

export const dynamic = "force-dynamic";

/** The bank payment file (Excel) for a locked payroll. `?leaveOut=1` leaves out people whose details can't be used; every download is recorded. */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  if (!can(ctx.role, "payment.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const f = await exportPaymentFile(ctx, runId, { leaveOutProblems: new URL(req.url).searchParams.get("leaveOut") === "1" });
    return new NextResponse(new Uint8Array(f.buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${f.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
