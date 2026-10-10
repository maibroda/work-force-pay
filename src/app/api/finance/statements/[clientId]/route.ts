import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { statementCsv } from "@/lib/statements";
import { logAudit } from "@/server/services/audit";
import { clientStatement } from "@/server/services/receipts";

export const dynamic = "force-dynamic";

/** A client's statement of account as a CSV, as at a date. */
export async function GET(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  if (!can(ctx.role, "gl.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const s = await clientStatement(ctx, clientId, new URL(req.url).searchParams.get("asOf") ?? undefined).catch(() => null);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit(ctx, { action: "REPORT_EXPORT", entity: "ClientStatement", entityId: clientId, newValue: { asOf: s.asOf.toISOString().slice(0, 10), lines: s.lines.length } });
  const name = s.client.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
  return new NextResponse(statementCsv(s.client.name, s.asOf, s), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="statement-${name}-${s.asOf.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
