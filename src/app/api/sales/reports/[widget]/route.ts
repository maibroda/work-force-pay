import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { reportCsv, WIDGET_KEYS } from "@/server/services/sales/reports";

export const dynamic = "force-dynamic";

/** One dashboard widget as a CSV: `?from=&to=` (Lagos dates) for the date filter, `&records=1` to add the records behind each figure. Every download is recorded. */
export async function GET(req: Request, { params }: { params: Promise<{ widget: string }> }) {
  const { widget } = await params;
  if (!WIDGET_KEYS.includes(widget)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  if (!can(ctx.role, "sales.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  try {
    const f = await reportCsv(ctx, widget, { from: q.get("from") || undefined, to: q.get("to") || undefined }, { records: q.get("records") === "1" });
    return new NextResponse(`\uFEFF${f.csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${f.fileName}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
