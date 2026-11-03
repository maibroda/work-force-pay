import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientIp, limitKey, unsubscribeLimiter } from "@/lib/rate-limit";
import { unsubscribe } from "@/server/services/sales/privacy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Opening this page withdraws the person's marketing consent at once, with no login. (A mail scanner that opens it only ever withdraws a marketing consent, the safe direction.)
 * The words are the same for every valid link, so the page reveals nothing about who is on file; an altered link does nothing.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let status: "done" | "invalid" | "error" | "slow" = "error";
  try {
    status = unsubscribeLimiter.check(limitKey(clientIp(await headers()), token)).ok ? (await unsubscribe(decodeURIComponent(token))).status : "slow";
  } catch {
    status = "error";
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 text-slate-900 shadow">
        {status === "done" ? (
          <>
            <h1 className="text-xl font-semibold">You are unsubscribed</h1>
            <p className="mt-2 text-sm text-slate-600">You will not be sent any more marketing messages. Messages about a service you already receive from us, such as your contract, can still be sent.</p>
            <p className="mt-2 text-sm text-slate-600">If you did this by mistake, tell the person who has been in touch with you and they can ask for your permission again.</p>
          </>
        ) : status === "slow" ? (
          <>
            <h1 className="text-xl font-semibold">Please wait a moment</h1>
            <p className="mt-2 text-sm text-slate-600">Too many attempts came from your connection. Try the link again in a minute.</p>
          </>
        ) : status === "invalid" ? (
          <>
            <h1 className="text-xl font-semibold">This link is not valid</h1>
            <p className="mt-2 text-sm text-slate-600">It may have been cut short when it was copied. Open it again from the original message, or reply to that message and ask to be removed.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">We could not finish that</h1>
            <p className="mt-2 text-sm text-slate-600">Please try the link again in a few minutes, or reply to the message and ask to be removed.</p>
          </>
        )}
      </div>
    </main>
  );
}
