"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { backTarget, isDirectoryUrl, markRestore } from "@/lib/profile-nav";
import { loadNav, saveNav } from "@/lib/nav-storage";

/**
 * The back arrow at the top left of an employee profile, shown by the profile's shared layout so it is on every tab and never repeated.
 * It returns to where the profile was opened from (the directory with its search, filters and page, or another page) and falls back
 * to the directory. The rules are in src/lib/profile-nav.ts.
 */
export function ProfileBackLink({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [href, setHref] = useState("/employees");
  useEffect(() => setHref(backTarget(loadNav(), employeeId)), [employeeId]);
  // honest about where it goes: the directory, or the page the profile was opened from
  const toDirectory = isDirectoryUrl(href);
  const label = toDirectory ? "Back to the employee directory" : "Back to the previous page";
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="no-print inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser open it in a new tab as usual
        e.preventDefault();
        const target = backTarget(loadNav(), employeeId);
        saveNav(markRestore(loadNav(), target));
        router.push(target);
      }}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {toDirectory ? "Employees" : "Back"}
    </Link>
  );
}
