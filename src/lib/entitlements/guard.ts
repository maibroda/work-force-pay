/**
 * The decision a guard makes, as pure functions (step E3a of docs/plans/module-entitlements-e3.md): given what a company has and which module an entry belongs to, may the
 * request go ahead, and should it only be reported. Nothing gives a signed-in person an `Entitlements` yet, so in the app today every guard allows everything.
 */
import { MODULES, type ModuleKey } from "./catalogue";
import { PAGE_MODULES, effectiveModule, type EntryModule } from "./entry-modules";

/** OFF is the absence of a mode. REPORT lets the request through and says what would have been refused; ENFORCE refuses. */
export type Mode = "REPORT" | "ENFORCE";

export interface Entitlements {
  /** The modules the company has today; null when it has no subscription, which counts as the core only. */
  modules: readonly ModuleKey[] | null;
  /** Per module. A module with no entry is OFF: nothing is checked for it. */
  modes: Partial<Record<ModuleKey, Mode>>;
}

export interface Decision {
  allow: boolean;
  /** Allowed only because the module is in REPORT mode: the caller should log that it would have been refused. */
  report: boolean;
  module: EntryModule;
  message?: string;
}

export const refusalMessage = (module: ModuleKey) => `${MODULES[module].name} is not part of your plan. Ask whoever looks after your account to add it.`;

export function decide(ent: Entitlements | undefined, module: EntryModule): Decision {
  const allow = { allow: true, report: false, module };
  if (!ent || module === "core" || module === "bureau") return allow; // nothing loaded (today), the core is always on, bureau tools answer to bureau mode and not to a purchase
  const mode = ent.modes[module];
  if (!mode) return allow;
  if ((ent.modules ?? ["core"]).includes(module)) return allow;
  return mode === "REPORT" ? { allow: true, report: true, module } : { allow: false, report: false, module, message: refusalMessage(module) };
}

/** Whether a menu should show a link: false only for a page of a module that is being enforced and was not bought. An address that is no page of ours is left to its own page. */
export function pageAllowed(ent: Entitlements | undefined, href: string): boolean {
  if (!ent) return true;
  const route = pageRouteFor(href);
  return !route || decide(ent, effectiveModule("page", route)).allow;
}

const PATTERNS = Object.keys(PAGE_MODULES).map((route) => ({ route, parts: route.split("/"), dynamic: route.split("/").filter((s) => s.startsWith("[")).length }));

/** Which page an address is for, treating [param] as a wildcard; the page with the exact address wins over one with a [param]. Null when no page has that address. */
export function pageRouteFor(address: string): string | null {
  const clean = address.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  const parts = clean.split("/");
  let best: (typeof PATTERNS)[number] | null = null;
  for (const p of PATTERNS) {
    if (p.parts.length !== parts.length) continue;
    if (!p.parts.every((seg, i) => (seg.startsWith("[") ? parts[i] !== "" : seg === parts[i]))) continue;
    if (!best || p.dynamic < best.dynamic) best = p;
  }
  return best?.route ?? null;
}
