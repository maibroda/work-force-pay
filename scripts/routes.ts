/**
 * Page discovery for the route smoke test, and for the unit test that checks the menus. Pure file-system
 * reading — it never starts the app. A page's required permission is read from its own source
 * (`requirePage("hr.view")`), so the test can't drift from what the page actually enforces.
 */
import fs from "node:fs";
import path from "node:path";
import type { Permission } from "../src/lib/auth/permissions";

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "src", "app", "(app)");

export interface PageInfo {
  /** The route pattern, e.g. "/employees/[id]". */
  route: string;
  file: string;
  /** The permission the page demands; null = any signed-in user; "custom" = it decides some other way. */
  perm: Permission | null | "custom";
  dynamic: boolean;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
}

function permOf(source: string): PageInfo["perm"] {
  const m = source.match(/requirePage\(\s*(?:"([a-z]+\.[a-z]+)"\s*)?\)/);
  if (m) return (m[1] as Permission | undefined) ?? null;
  return "custom";
}

/** Every page under the signed-in app shell. */
export function discoverPages(): PageInfo[] {
  return walk(APP)
    .map((file) => {
      const rel = path.relative(APP, path.dirname(file)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
      const route = "/" + rel.join("/");
      return { route, file, perm: permOf(fs.readFileSync(file, "utf8")), dynamic: route.includes("[") };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

/** Finds the page a concrete path (a menu link) belongs to, treating [param] segments as wildcards. */
export function matchPage(pages: PageInfo[], href: string): PageInfo | undefined {
  const clean = href.split("?")[0].replace(/\/$/, "") || "/";
  const parts = clean.split("/");
  return pages.find((p) => {
    const rp = p.route.split("/");
    return rp.length === parts.length && rp.every((seg, i) => (seg.startsWith("[") ? parts[i] !== "" : seg === parts[i]));
  });
}

/** The tab keys an employee page renders (`tab === "documents"`), so each one can be requested. */
export function employeeTabs(): string[] {
  const src = fs.readFileSync(path.join(APP, "employees", "[id]", "page.tsx"), "utf8");
  return [...new Set([...src.matchAll(/tab === "([a-z]+)"/g)].map((m) => m[1]))];
}
