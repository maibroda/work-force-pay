import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { exportForRequest } from "@/server/services/data-requests";

export const dynamic = "force-dynamic";

/** HR's copy of one person's data for an open, identity-checked request. Generated on the spot, never stored. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const out = await exportForRequest(ctx, id);
    return new NextResponse(out.text, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.requestNumber}-data-${out.data.subject.employeeNumber}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
