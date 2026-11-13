"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { afterBack, backDestination, type BackDestination } from "@/lib/global-back";
import { markRestore, profileIdFromPath } from "@/lib/profile-nav";
import { loadNav, saveNav } from "@/lib/nav-storage";

/**
 * The Back button, top left of every page inside the app, drawn once by the shared layout (never per module). It returns to the page the person was just on; with nothing earlier in
 * the app (a direct address, a refresh in a new tab) it goes to the parent module or the person's home, and it is hidden on a landing page with nothing before it. An employee's
 * profile keeps its own arrow (which also remembers the directory's search and filters), so it is not drawn there. The rules are in src/lib/global-back.ts.
 */
export function GlobalBackButton({ home }: { home: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = pathname + (search ? `?${search}` : "");
  const [dest, setDest] = useState<BackDestination | null>(null);

  // worked out after the page has loaded: the trail lives in the browser's session storage
  useEffect(() => {
    setDest(profileIdFromPath(url) ? null : backDestination(loadNav(), url, home));
  }, [url, home]);

  if (!dest) return <span className="h-9 w-9" aria-hidden="true" />;
  const label = dest.kind === "previous" ? "Go back to the previous page" : "Go back";
  return (
    <Link
      href={dest.href}
      aria-label={label}
      title="Go Back"
      className="no-print inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser open it in a new tab as usual
        e.preventDefault();
        // worked out again now, from the latest trail, so a stale arrow can never send the person somewhere they did not come from
        const state = loadNav();
        const target = backDestination(state, url, home);
        if (!target) return;
        saveNav(markRestore(afterBack(state, target.href, target.kind), target.href));
        router.push(target.href);
      }}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">Back</span>
    </Link>
  );
}
