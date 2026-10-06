import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { exportMyData } from "@/server/services/data-requests";

export const dynamic = "force-dynamic";

/** An employee's own data, as a file. It only ever returns the signed-in employee's record. */
export async function GET() {
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const out = await exportMyData(ctx);
    return new NextResponse(out.text, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="my-data-${out.data.subject.employeeNumber}-${out.data.generatedOn}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
