import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { buildReport, REPORT_TYPES, type ReportType } from "@/server/report-registry";
import { toCsv } from "@/server/services/reports";
import { reportPermission } from "@/lib/report-access";
import { logAudit } from "@/server/services/audit";

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, reportPermission(type)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!REPORT_TYPES.includes(type as ReportType))
    return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const report = await buildReport(ctx, type as ReportType, sp);
  if (!report) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const csv = toCsv(
    report.rows.map(({ _total, ...r }) => (void _total, r)),
    report.columns,
  );
  await logAudit(ctx, {
    action: "REPORT_EXPORT",
    entity: "Report",
    entityId: type,
    newValue: { rows: report.rows.length, params: sp },
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
