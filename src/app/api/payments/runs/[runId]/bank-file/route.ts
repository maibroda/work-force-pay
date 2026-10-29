import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { exportPaymentFile } from "@/server/services/payment-file";

export const dynamic = "force-dynamic";

/** The bank payment file for a locked payroll. `?bank=` makes it for that paying bank (its codes and layout); `?leaveOut=1` leaves out people whose details can't be used; every download is recorded. */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  if (!can(ctx.role, "payment.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const q = new URL(req.url).searchParams;
    const f = await exportPaymentFile(ctx, runId, { leaveOutProblems: q.get("leaveOut") === "1", payingBankId: q.get("bank") || null });
    return new NextResponse(new Uint8Array(f.buffer), {
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": `attachment; filename="${f.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
