/**
 * The back arrow on an employee profile: where it goes, and what is remembered so that the directory comes back
 * as it was left (search, filters, page and scroll position). Pure rules, no browser here; src/components/nav-tracker.tsx
 * keeps the state in sessionStorage and src/components/profile-back-link.tsx shows the arrow.
 *
 * An address is a path with its query, like "/employees?q=ada&page=2". The state remembers:
 *  - dir: the last directory address seen (the fallback after a refresh or a bookmark);
 *  - origin: where the person came from when they opened a profile (the directory with its filters, or another page), for that employee only;
 *  - scroll: how far each recently left page was scrolled, and restore: the address the arrow just sent the person to.
 */

/** Pages that sit directly inside Employees and are not an employee's profile. A test compares this list with the folders so it cannot drift. */
export const EMPLOYEE_STATIC_SEGMENTS = [
  "bank",
  "categories",
  "change-requests",
  "departments",
  "dependants",
  "guarantors",
  "import",
  "new",
  "next-of-kin",
  "org-chart",
  "pay-rates",
  "pension",
  "pfas",
  "tax",
] as const;

export interface NavState {
  dir?: string;
  origin?: { id: string; url: string };
  scroll?: Record<string, number>;
  restore?: string;
  /** The global Back button (src/lib/global-back.ts): the in-app addresses visited, oldest first, and an address Back just sent the person to with nothing earlier. */
  trail?: string[];
  fresh?: string;
}

const MAX_REMEMBERED_SCROLLS = 20;

const pathOf = (url: string) => url.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

/** The employee id when this address is an employee's profile (/employees/<id>, with or without a tab), else null. */
export function profileIdFromPath(url: string): string | null {
  const m = /^\/employees\/([^/]+)$/.exec(pathOf(url));
  if (!m) return null;
  return (EMPLOYEE_STATIC_SEGMENTS as readonly string[]).includes(m[1]) ? null : m[1];
}

/** Only an address inside the app can be a place to go back to: it must start with a single slash. */
export function safeInternal(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return null;
  return url;
}

/** Called on every move from one address to another. */
export function onNavigate(state: NavState, from: string | null, to: string): NavState {
  const s: NavState = { ...state };
  if (from && pathOf(from) === "/employees") s.dir = from; // also when it is only the page being left
  if (pathOf(to) === "/employees") s.dir = to; // the newer address wins when moving between directory pages
  const id = profileIdFromPath(to);
  // opening a profile from somewhere else: remember where from; moving between its tabs changes nothing
  if (id && from && profileIdFromPath(from) !== id) s.origin = { id, url: from };
  return s;
}

/** Whether an address is the directory itself (with or without a search, filters or page). */
export function isDirectoryUrl(url: string): boolean {
  return pathOf(url) === "/employees";
}

/** Where the arrow goes: where this employee's profile was opened from, else the last directory, else the directory. */
export function backTarget(state: NavState, employeeId: string): string {
  if (state.origin?.id === employeeId) {
    const o = safeInternal(state.origin.url);
    if (o) return o;
  }
  return safeInternal(state.dir) ?? "/employees";
}

/** Remembers how far an address was scrolled, keeping only the most recent few. */
export function rememberScroll(state: NavState, url: string, y: number): NavState {
  const scroll = { ...(state.scroll ?? {}) };
  delete scroll[url]; // so it counts as the most recent
  scroll[url] = Math.max(0, Math.round(y));
  const keys = Object.keys(scroll);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_SCROLLS))) delete scroll[k];
  return { ...state, scroll };
}

/** The arrow was used: restore the scroll position when the person lands on this address. */
export function markRestore(state: NavState, target: string): NavState {
  return { ...state, restore: target };
}

/** On arriving at an address: the scroll position to restore (once), or null. */
export function takeRestore(state: NavState, current: string): { state: NavState; y: number | null } {
  if (state.restore !== current) return { state, y: null };
  const { restore: _restore, ...rest } = state;
  void _restore;
  return { state: rest, y: state.scroll?.[current] ?? null };
}
