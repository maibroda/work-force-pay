import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { ForbiddenError } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { openFile } from "@/server/services/documents";
import { routeRefusal } from "@/server/services/entitlement-guard";

export const dynamic = "force-dynamic";

/**
 * A document's file, reached only through a short-lived signed link (issued by the register after the permission check). The link works for one signed-in
 * user for five minutes; the permission is checked again here, the file is decrypted and checked against its checksum, and the access is audited.
 * Never cached, never guessed from a file name.
 */
export async function GET(req: Request) {
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await twoFactorStateFor(ctx)).state === "BLOCKED") return NextResponse.json({ error: "Two-factor authentication is required for your role. Turn it on under Settings, Security." }, { status: 403 });
  const off = routeRefusal(ctx, "/api/documents/file");
  if (off) return off;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  try {
    const out = await openFile(ctx, token);
    const ascii = out.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
    return new NextResponse(new Uint8Array(out.bytes), {
      headers: {
        "Content-Type": out.mime,
        "Content-Length": String(out.bytes.length),
        "Content-Disposition": `${out.disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
