import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { MODULE_KEYS } from "@/lib/entitlements/catalogue";
import { ACTION_MODULES, API_MODULES, JOB_MODULES, PAGE_MODULES, UNCONFIRMED, effectiveModule } from "@/lib/entitlements/entry-modules";
import { discoverPages } from "../../scripts/routes";

/**
 * Step E3a of docs/plans/module-entitlements-e3.md. Every way into the app (a page, a server-action file, an API route, a scheduled job) must say which module it belongs to,
 * so that nothing can be added without saying. Nothing here turns anything off: it only pins that the declarations are complete, current and sensible.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const walk = (dir: string, match: (f: string) => boolean, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, match, out);
    else if (match(e.name)) out.push(p);
  }
  return out;
};
const diff = (found: string[], declared: string[]) => ({ undeclared: found.filter((x) => !declared.includes(x)).sort(), stale: declared.filter((x) => !found.includes(x)).sort() });

const apiRoutes = walk(path.join(ROOT, "src", "app", "api"), (n) => n === "route.ts").map((f) => "/api/" + path.relative(path.join(ROOT, "src", "app", "api"), path.dirname(f)).split(path.sep).join("/"));
const actionFiles = fs.readdirSync(path.join(ROOT, "src", "app", "actions")).filter((f) => f.endsWith(".ts") && !f.startsWith("_"));
const pages = discoverPages();

describe("every way into the app says which module it belongs to", () => {
  it("has a module for every page, and none for a page that no longer exists", () => {
    expect(diff(pages.map((p) => p.route), Object.keys(PAGE_MODULES))).toEqual({ undeclared: [], stale: [] });
  });

  it("has a module for every server-action file, and none for a file that no longer exists", () => {
    expect(diff(actionFiles, Object.keys(ACTION_MODULES))).toEqual({ undeclared: [], stale: [] });
  });

  it("has a module for every API route and every scheduled job, and none for a route that no longer exists", () => {
    const jobs = apiRoutes.filter((r) => r.startsWith("/api/cron/"));
    const others = apiRoutes.filter((r) => !r.startsWith("/api/cron/"));
    expect(diff(jobs, Object.keys(JOB_MODULES))).toEqual({ undeclared: [], stale: [] });
    expect(diff(others, Object.keys(API_MODULES))).toEqual({ undeclared: [], stale: [] });
  });

  it("uses only modules that exist, or \"bureau\" (tools that exist in bureau mode only, which are not a module a client buys)", () => {
    const allowed = new Set<string>([...MODULE_KEYS, "bureau"]);
    for (const [kind, map] of Object.entries({ page: PAGE_MODULES, action: ACTION_MODULES, api: API_MODULES, job: JOB_MODULES }))
      for (const [entry, m] of Object.entries(map)) expect(allowed.has(m), `${kind} ${entry} -> ${m}`).toBe(true);
  });

  it("lists as unconfirmed only entries that exist, and treats an unconfirmed entry as the core (open to everyone) so a guess can never lock anyone out", () => {
    const maps = { page: PAGE_MODULES, action: ACTION_MODULES, api: API_MODULES, job: JOB_MODULES } as const;
    for (const u of UNCONFIRMED) {
      const [kind, ...rest] = u.split(" ");
      expect(maps[kind as keyof typeof maps]?.[rest.join(" ")], `unconfirmed ${u} is not declared`).toBeDefined();
    }
    expect(UNCONFIRMED.size).toBeGreaterThan(0);
    const [kind, ...rest] = [...UNCONFIRMED][0].split(" ");
    expect(effectiveModule(kind as "page", rest.join(" "))).toBe("core");
    expect(effectiveModule("page", "/accounting/accounts")).toBe("accounting"); // a confirmed one is what it says
  });

  it("puts the places that must always work in the core: the home page, the subscription page itself, the audit log and a person's own security", () => {
    for (const p of ["/", "/settings/subscription", "/settings/security", "/settings/audit"]) expect(effectiveModule("page", p), p).toBe("core");
  });
});

describe("permissions that are shared between modules (why the module cannot come from the permission alone)", () => {
  it("are exactly these; a new one means a page's module must be looked at by a person", () => {
    // the module each permission's pages are in; a permission whose pages are in more than one module cannot tell which module an action belongs to
    const by = new Map<string, Set<string>>();
    for (const p of pages) {
      if (p.perm === null || p.perm === "custom") continue;
      by.set(p.perm, (by.get(p.perm) ?? new Set()).add(PAGE_MODULES[p.route]));
    }
    const shared = [...by].filter(([, m]) => m.size > 1).map(([perm]) => perm).sort();
    expect(shared).toEqual(["client.view", "employee.sensitive", "employee.view", "gl.view", "operations.view", "payment.manage", "payroll.view", "users.manage"]);
    for (const perm of shared) expect((PERMISSIONS as readonly string[]).includes(perm)).toBe(true);
  });
});
