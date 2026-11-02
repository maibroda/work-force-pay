import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { IMPORT_KINDS, importTemplateCsv, type ImportKind } from "@/lib/sales/import";

export const dynamic = "force-dynamic";

/** The blank CSV for importing leads, accounts or contacts: the column headers and one example row. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = kind.toUpperCase() as ImportKind;
  if (!IMPORT_KINDS.includes(k)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  if (!can(ctx.role, "sales.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return new NextResponse(`﻿${importTemplateCsv(k)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sales-${kind}-import-template.csv"`, "Cache-Control": "no-store" },
  });
}
