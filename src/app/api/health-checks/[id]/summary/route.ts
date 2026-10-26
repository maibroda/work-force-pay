import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { ForbiddenError } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { summaryFile } from "@/server/services/health-checks";

export const dynamic = "force-dynamic";

/** The one-page summary of a health check as a PDF (stamped as a draft until it is issued). Every download is audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  try {
    const f = await summaryFile(ctx, id);
    return new NextResponse(new Uint8Array(f.bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${f.fileName}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
