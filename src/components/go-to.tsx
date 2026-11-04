"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchPages, type JumpPage } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * "Go to": type a few letters of what you are looking for and jump to the page. Press / anywhere to start. It lists only the pages this person may open (the list is made on the server
 * from their role and the company's modules), so it shows nothing that the menu would not.
 */
export function GoTo({ pages }: { pages: JumpPage[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const found = useMemo(() => searchPages(pages, q), [pages, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setQ("");
    setOpen(false);
    input.current?.blur();
    router.push(href);
  };

  return (
    <div className="relative">
      <label className="flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-sm focus-within:ring-2 focus-within:ring-primary/40">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="sr-only">Go to a page</span>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => Math.min(i + 1, found.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && found[at]) {
              e.preventDefault();
              go(found[at].href);
            } else if (e.key === "Escape") {
              setQ("");
              input.current?.blur();
            }
          }}
          placeholder="Go to…  ( / )"
          className="w-28 bg-transparent outline-none placeholder:text-muted-foreground sm:w-44"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && found.length > 0}
          aria-controls="goto-list"
        />
      </label>
      {open && q.trim() !== "" && (
        <ul id="goto-list" role="listbox" className="absolute right-0 z-50 mt-1 w-80 max-w-[90vw] overflow-hidden rounded-md border bg-card shadow-lg">
          {found.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nothing matches &ldquo;{q.trim()}&rdquo;.</li>}
          {found.map((p, i) => (
            <li key={p.href} role="option" aria-selected={i === at}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(p.href)} className={cn("block w-full px-3 py-2 text-left text-sm hover:bg-accent", i === at && "bg-accent")}>
                <span className="font-medium">{p.label}</span>
                <span className="block text-xs text-muted-foreground">{p.where}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
