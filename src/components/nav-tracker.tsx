"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { onNavigate, rememberScroll, takeRestore } from "@/lib/profile-nav";
import { loadNav, saveNav } from "@/lib/nav-storage";

/**
 * Remembers, for the back arrow on an employee profile, where each page was reached from and how far it was scrolled,
 * and puts the scroll position back when the arrow returns to it. It draws nothing. The rules are in src/lib/profile-nav.ts.
 */
export function NavTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = pathname + (search ? `?${search}` : "");
  const previous = useRef<string | null>(null);
  const current = useRef(url);
  current.current = url;

  // how far this page is scrolled, taken at the moment a link is used (before the next page takes over the scroll position)
  useEffect(() => {
    const keep = () => saveNav(rememberScroll(loadNav(), current.current, window.scrollY));
    document.addEventListener("click", keep, true);
    window.addEventListener("pagehide", keep);
    return () => {
      document.removeEventListener("click", keep, true);
      window.removeEventListener("pagehide", keep);
    };
  }, []);

  useEffect(() => {
    let state = loadNav();
    state = onNavigate(state, previous.current, url);
    previous.current = url;
    const restored = takeRestore(state, url);
    saveNav(restored.state);
    if (restored.y !== null) {
      const y = restored.y;
      // the page can still be filling in: try a few times
      for (const delay of [0, 120, 400, 900]) window.setTimeout(() => window.scrollTo({ top: y }), delay);
    }
  }, [url]);

  return null;
}
