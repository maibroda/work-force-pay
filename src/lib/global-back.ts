/**
 * The global Back button (the founder's brief of 2026-11-13): on every page inside the app, a Back arrow at the top left that returns to the page the person was just on. Pure rules, no
 * browser here. The state is the same sessionStorage record as the employee profile's arrow (src/lib/nav-storage.ts, `NavState` in src/lib/profile-nav.ts); the tracker
 * (src/components/nav-tracker.tsx) calls `advanceTrail` on every move, and src/components/global-back-button.tsx shows the arrow.
 *
 * What it remembers is the trail of in-app addresses the person has moved through (path and query, like "/hr/contracts?page=2"):
 *  - a new address is added once; the same address again (a refresh) changes nothing;
 *  - arriving at the address BEFORE the current one (the Back button, the browser's back, or a link to it) drops the page that was left, so one Back click is one step and the trail
 *    never grows in a circle;
 *  - with no earlier page in the app (a direct address, a bookmark, a new tab) Back goes UP: a record to its list, a list to its module, a module to the person's home, and the
 *    trail starts again there, so Back from the parent never comes back down. Nothing here ever returns an address outside the app.
 */
import { safeInternal, type NavState } from "./profile-nav";

/** The part of the saved state this uses. */
export type Trail = NavState;

export const MAX_TRAIL = 30;

const pathOf = (url: string) => url.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

/**
 * Where a module's own front page is, for pages with no earlier page to go back to. Each is a page the sidebar or a tab row links to; a test compares this table with
 * the navigation so it cannot drift. A module not listed goes to the person's home.
 */
export const SECTION_HOMES: Record<string, string> = {
  hr: "/hr",
  leave: "/leave",
  employees: "/employees",
  payroll: "/payroll/runs",
  payments: "/payroll/runs",
  contracts: "/clients",
  clients: "/clients",
  operations: "/operations/activation",
  finance: "/finance/invoices",
  accounting: "/accounting/journals",
  analytics: "/analytics/payroll",
  reports: "/reports",
  settings: "/settings/organization",
  sales: "/sales/leads",
  bureau: "/bureau",
  portal: "/portal",
  me: "/me",
  supervisor: "/supervisor",
};

/** Pages a person lands on after signing in: with nothing earlier to go back to, there is nowhere to go from them. */
const LANDING_PATHS = new Set(["/", "/me", "/supervisor", "/crm", "/sales/tasks", "/portal"]);

/** A record's identifier at the end of an address: a cuid, a uuid or a number. */
const RECORD_ID = /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

/** Where a person goes from a page when nothing earlier exists in the app. `home` is the person's own home page (the dashboard, or My Workspace for someone who cannot open it). */
export function fallbackFor(url: string, home: string): string {
  const path = pathOf(url);
  if (path === "/") return home;
  const parts = path.split("/").filter(Boolean);
  // a record goes to its list
  if (parts.length > 1 && RECORD_ID.test(parts[parts.length - 1])) return "/" + parts.slice(0, -1).join("/");
  const moduleHome = SECTION_HOMES[parts[0]];
  if (moduleHome && moduleHome !== path) return moduleHome;
  return home;
}

/** The dashboard for anyone who can open it; otherwise My Workspace (an employee would be refused the dashboard). */
export const homeFor = (canOpenDashboard: boolean): string => (canOpenDashboard ? "/" : "/me");

const sanitise = (trail: unknown): string[] => (Array.isArray(trail) ? trail.filter((u): u is string => typeof u === "string" && safeInternal(u) !== null) : []);

/** Called on every move from one address to another (from is null on the first page of a visit, and after a refresh). */
export function advanceTrail(state: Trail, _from: string | null, to: string): Trail {
  void _from;
  const trail = sanitise(state.trail);
  const top = trail[trail.length - 1];
  const { fresh, ...rest } = state;
  // the person was sent to a parent by Back with nothing earlier: the trail starts again there
  if (fresh === to) return { ...rest, trail: [to] };
  if (top === to) return { ...rest, trail }; // a refresh, or the same page again
  // moving to the page before this one: the page that was left is dropped
  if (trail.length >= 2 && trail[trail.length - 2] === to) return { ...rest, trail: trail.slice(0, -1) };
  const next = [...trail, to];
  return { ...rest, trail: next.slice(Math.max(0, next.length - MAX_TRAIL)) };
}

export interface BackDestination {
  href: string;
  /** "previous": the page the person was just on. "parent": nothing earlier, so the module or home. */
  kind: "previous" | "parent";
}

/** Where Back goes from `current`, or null when there is nowhere to go (a landing page with nothing before it). */
export function backDestination(state: Trail, current: string, home: string): BackDestination | null {
  const trail = sanitise(state.trail);
  const top = trail[trail.length - 1];
  // the tracker may not have recorded this page yet: then the last entry is the one before it
  const previous = top === current ? trail[trail.length - 2] : top;
  if (previous && previous !== current) return { href: previous, kind: "previous" };
  const path = pathOf(current);
  if (LANDING_PATHS.has(path) || path === pathOf(home)) return null;
  const fallback = fallbackFor(current, home);
  return pathOf(fallback) === path ? null : { href: fallback, kind: "parent" };
}

/** Back was used: say where it went, so the trail is kept honest on arrival. Going to a parent starts a new trail there. */
export function afterBack(state: Trail, target: string, kind: BackDestination["kind"]): Trail {
  return kind === "parent" ? { ...state, fresh: target } : state;
}
