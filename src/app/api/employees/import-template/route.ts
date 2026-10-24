import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { can } from "@/lib/auth/permissions";
import { importTemplateCsv } from "@/lib/employee-import";

export const dynamic = "force-dynamic";

/** The blank CSV for importing employees: the column headers and one example row. */
export async function GET() {
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under My security." }, { status: 403 });
  if (!can(ctx.role, "employee.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return new NextResponse(`﻿${importTemplateCsv()}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="employee-import-template.csv"',
    },
  });
}
