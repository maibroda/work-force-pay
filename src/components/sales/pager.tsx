import Link from "next/link";
import { windowOf } from "@/lib/sales/paging";

/** Previous and next links for a paged list. The page and the other filters travel in the web address, so a page can be bookmarked and the back button works. */
export function Pager({ path, total, page, pageSize, params = {} }: { path: string; total: number; page: number; pageSize: number; params?: Record<string, string | undefined> }) {
  const w = windowOf(total, { page, pageSize });
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(n));
    return `${path}?${q.toString()}`;
  };
  if (w.pages <= 1) return <p className="px-4 py-2 text-xs text-muted-foreground">{total === 0 ? "Nothing to show." : `All ${total} shown.`}</p>;
  return (
    <nav className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm" aria-label="Pages">
      <span className="text-xs text-muted-foreground">
        {w.from} to {w.to} of {total}
      </span>
      {w.page > 1 ? <Link className="underline" href={href(w.page - 1)}>Previous</Link> : <span className="text-muted-foreground">Previous</span>}
      <span className="text-xs">Page {w.page} of {w.pages}</span>
      {w.page < w.pages ? <Link className="underline" href={href(w.page + 1)}>Next</Link> : <span className="text-muted-foreground">Next</span>}
    </nav>
  );
}
