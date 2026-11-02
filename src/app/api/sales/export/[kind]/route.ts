import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { IMPORT_KINDS, type ImportKind } from "@/lib/sales/import";
import { BusinessError } from "@/server/services/_base";
import { exportCsv } from "@/server/services/sales/export";

export const dynamic = "force-dynamic";

/** The leads, accounts or contacts the caller may see, as a CSV. Every download is recorded. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = kind.toUpperCase() as ImportKind;
  if (!IMPORT_KINDS.includes(k)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  if (!can(ctx.role, "sales.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const f = await exportCsv(ctx, k);
    return new NextResponse(`﻿${f.csv}`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${f.fileName}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
