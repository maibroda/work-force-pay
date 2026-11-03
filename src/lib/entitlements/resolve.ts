/**
 * The rules over the catalogue (catalogue.ts): what a selection of modules needs, whether a plan with add-ons holds together, what removing a module would break, and where a
 * port gets its answer. Pure functions: no database, no clock, and nothing in the app calls them yet (step E1 of docs/plans/module-entitlements.md).
 */
import { MODULES, MODULE_KEYS, PLANS, PORTS, type ModuleKey, type PlanKey, type PortKey } from "./catalogue";

const ORDER = new Map(MODULE_KEYS.map((k, i) => [k, i]));
const sorted = (xs: Iterable<ModuleKey>): ModuleKey[] => [...new Set(xs)].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
const isKey = (x: unknown): x is ModuleKey => typeof x === "string" && ORDER.has(x as ModuleKey);
const name = (k: ModuleKey) => MODULES[k].name;
const list = (ks: ModuleKey[]) => (ks.length <= 1 ? ks.map(name).join("") : `${ks.slice(0, -1).map(name).join(", ")} or ${name(ks[ks.length - 1])}`);

export interface Problem {
  kind: "UNKNOWN_MODULE" | "ALREADY_INCLUDED" | "NEEDS_MISSING" | "NEEDS_ONE_OF";
  module: string;
  message: string;
  missing?: ModuleKey[];
  oneOf?: ModuleKey[];
}
export interface Added {
  module: ModuleKey;
  /** The modules that needed it. */
  neededBy: ModuleKey[];
  /** In words a salesperson can repeat to the client. */
  because: string;
}

/**
 * The selection, plus everything it needs. The core is always there. A need that has to be met by one of several modules (client billing needs contracts and deployment OR the
 * CRM) is already met if the client has one; if none is there, the first of `prefer` that is a choice, otherwise the first choice listed, is added, and the reason says so.
 * The same answer however the selection is ordered or repeated.
 */
export function resolveModules(selected: readonly string[], opts: { prefer?: readonly ModuleKey[] } = {}): { modules: ModuleKey[]; added: Added[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const set = new Set<ModuleKey>(["core"]); // always on, so it is never reported as added
  for (const s of selected) {
    if (isKey(s)) set.add(s);
    else if (!problems.some((p) => p.module === s)) problems.push({ kind: "UNKNOWN_MODULE", module: String(s), message: `There is no module called "${String(s)}".` });
  }
  const asked = new Set(set);
  const addedBy = new Map<ModuleKey, { neededBy: Set<ModuleKey>; because: string }>();
  const add = (k: ModuleKey, by: ModuleKey, because: string) => {
    set.add(k);
    const e = addedBy.get(k);
    if (e) e.neededBy.add(by);
    else addedBy.set(k, { neededBy: new Set([by]), because });
  };
  for (let changed = true; changed; ) {
    changed = false;
    // 1. every need that has to be there, until nothing more is needed
    for (let more = true; more; ) {
      more = false;
      for (const k of sorted(set))
        for (const n of MODULES[k].needs)
          if (!set.has(n)) {
            add(n, k, `${name(k)} needs ${name(n)}, so ${name(n)} was added.`);
            more = changed = true;
          } else if (addedBy.has(n)) addedBy.get(n)!.neededBy.add(k);
    }
    // 2. then each either-or need that is still unmet, decided with everything above already known
    for (const k of sorted(set))
      for (const group of MODULES[k].needsOneOf)
        if (!group.some((g) => set.has(g))) {
          const pick = (opts.prefer ?? []).find((p) => group.includes(p)) ?? group[0];
          const others = group.filter((g) => g !== pick);
          add(pick, k, `${name(k)} needs one of ${list(group)}; ${name(pick)} was added${others.length ? ` (change it if the client wants ${list(others)} instead)` : ""}.`);
          changed = true;
        }
  }
  const modules = sorted(new Set<ModuleKey>(["core", ...set])); // the core is always there
  const added = sorted(addedBy.keys())
    .filter((k) => !asked.has(k))
    .map((k) => ({ module: k, neededBy: sorted(addedBy.get(k)!.neededBy), because: addedBy.get(k)!.because }));
  return { modules, added, problems };
}

/** The modules a plan includes (the core always). */
export const planModules = (plan: PlanKey): ModuleKey[] => sorted(new Set<ModuleKey>(["core", ...PLANS[plan].modules]));

/** What is missing for a module in a set: hard needs not in it, and either-or groups with no choice in it. */
function unmet(k: ModuleKey, set: ReadonlySet<ModuleKey>): { missing: ModuleKey[]; groups: ModuleKey[][] } {
  return { missing: MODULES[k].needs.filter((n) => !set.has(n)), groups: MODULES[k].needsOneOf.filter((g) => !g.some((x) => set.has(x))) };
}

/**
 * Does a plan with these add-ons hold together? An add-on that does not exist, that the plan already includes, or whose needs are not met by the plan and the other add-ons
 * is refused, and the message says what to add. The custom plan is the core plus whatever is added.
 */
export function checkPlan(plan: PlanKey, addOns: readonly string[]): { ok: boolean; modules: ModuleKey[]; problems: Problem[] } {
  const base = new Set(planModules(plan));
  const problems: Problem[] = [];
  const wanted: ModuleKey[] = [];
  for (const a of addOns) {
    if (!isKey(a)) problems.push({ kind: "UNKNOWN_MODULE", module: String(a), message: `There is no module called "${String(a)}".` });
    else if (base.has(a)) problems.push({ kind: "ALREADY_INCLUDED", module: a, message: `${name(a)} is already part of the ${PLANS[plan].name} plan.` });
    else if (!wanted.includes(a)) wanted.push(a);
  }
  const all = new Set<ModuleKey>([...base, ...wanted]);
  for (const k of wanted) {
    const u = unmet(k, all);
    if (u.missing.length) problems.push({ kind: "NEEDS_MISSING", module: k, missing: u.missing, message: `${name(k)} needs ${list(u.missing)}. Add ${u.missing.length > 1 ? "them" : "it"} as well.` });
    for (const g of u.groups) problems.push({ kind: "NEEDS_ONE_OF", module: k, oneOf: g, message: `${name(k)} needs one of ${list(g)}. Add one of them as well.` });
  }
  return { ok: problems.length === 0, modules: sorted(all), problems };
}

export interface Broken {
  module: ModuleKey;
  because: string;
}

/**
 * What would stop working if these modules were removed from the set: each remaining module that loses something it needs, with the reason. An either-or need survives while
 * one choice remains. Modules removed together are counted together. The core cannot be removed.
 */
export function whatRemovalBreaks(current: readonly ModuleKey[], remove: readonly ModuleKey[]): { broken: Broken[]; refused: { module: ModuleKey; message: string }[] } {
  const refused = remove.includes("core") ? [{ module: "core" as ModuleKey, message: "The core platform is always on and cannot be removed." }] : [];
  const gone = new Set<ModuleKey>(remove.filter((r) => r !== "core"));
  const remaining = new Set(current.filter((c) => !gone.has(c)));
  const broken: Broken[] = [];
  for (const k of sorted(remaining)) {
    const reasons: string[] = [];
    for (const n of MODULES[k].needs) if (gone.has(n)) reasons.push(`${name(k)} needs ${name(n)}.`);
    for (const g of MODULES[k].needsOneOf) if (g.some((x) => gone.has(x)) && !g.some((x) => remaining.has(x))) reasons.push(`${name(k)} needs one of ${list(g)}.`);
    if (reasons.length) broken.push({ module: k, because: reasons.join(" ") });
  }
  return { broken, refused };
}

/** Where a port gets its answer for a client with these modules: the first source whose modules the client has; the last is the fallback. */
export function portSource(modules: readonly ModuleKey[], port: PortKey): { source: string; label: string; fallback: boolean } {
  const def = PORTS.find((p) => p.key === port);
  if (!def) throw new Error(`There is no port called "${port}".`);
  const have = new Set(modules);
  const hit = def.choices.find((c) => c.requires.every((r) => have.has(r)))!;
  return { source: hit.source, label: hit.label, fallback: hit.requires.length === 0 };
}
