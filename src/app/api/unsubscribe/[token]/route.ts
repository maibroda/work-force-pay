import { NextResponse } from "next/server";
import { clientIp, unsubscribeLimiter } from "@/lib/rate-limit";
import { limitedResponse } from "@/lib/rate-limit-http";
import { unsubscribe } from "@/server/services/sales/privacy";

export const dynamic = "force-dynamic";

/** One-click unsubscribe: a mail program POSTs here (RFC 8058). It answers the same whatever the token, so nothing is learned about who is on file. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const slow = limitedResponse(unsubscribeLimiter, clientIp(req.headers));
  if (slow) return slow;
  const { token } = await params;
  try {
    await unsubscribe(token);
  } catch {
    // never say why: the answer must not depend on who is on file
  }
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** A person who opens the one-click address in a browser is sent on to the page. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, req.url), 303);
}
