import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { inputTemplateCsv } from "@/lib/client-inputs";

export const dynamic = "force-dynamic";

/** The blank CSV a client fills in for the month's inputs: the column headers and three example rows. */
export async function GET() {
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required. Set it up under My security." }, { status: 403 });
  if (!can(ctx.role, "portal.inputs")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return new NextResponse(`﻿${inputTemplateCsv()}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="monthly-inputs-template.csv"',
    },
  });
}
