/**
 * Pure rules for comparing a payroll with the one before it. No database here.
 *
 * Two things come out of the same comparison: the findings that must be explained in writing before a payroll is submitted
 * (headcount moved, total net pay moved, one person's net pay moved), and the reconciliation bridge that walks last month's headcount and
 * net pay to this month's through joiners, leavers and changes for continuing staff. Money is in kobo so nothing drifts.
 */

export type VariancePolicy = { headcountPct: number; employeePct: number; totalPct: number; minAmount: number };
export const DEFAULT_VARIANCE_POLICY: VariancePolicy = { headcountPct: 5, employeePct: 20, totalPct: 10, minAmount: 5000 };

export type PayPerson = { id: string; label: string; gross: number; net: number };
export type VarianceCode = "HEADCOUNT_CHANGE" | "TOTAL_NET_VARIANCE" | "EMPLOYEE_NET_VARIANCE";
export type VarianceFinding = { code: VarianceCode; employeeId: string | null; message: string };

type Compare = { prior: PayPerson[]; current: PayPerson[]; joiners: ReadonlySet<string>; leavers: ReadonlySet<string> };

const kobo = (n: number) => Math.round(n * 100);
const money = (k: number) => (k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctText = (n: number) => `${Math.round(n * 10) / 10}%`;

/** Percent change from `from` to `to`, or null when there is nothing to compare against. */
function pctChange(from: number, to: number): number | null {
  return from === 0 ? null : ((to - from) / Math.abs(from)) * 100;
}

export function varianceFindings(input: Compare & { policy: VariancePolicy }): VarianceFinding[] {
  const { prior, current, joiners, leavers, policy } = input;
  const out: VarianceFinding[] = [];
  if (!prior.length) return out;

  const hc = pctChange(prior.length, current.length);
  if (hc !== null && Math.abs(hc) > policy.headcountPct) {
    out.push({
      code: "HEADCOUNT_CHANGE",
      employeeId: null,
      message: `Headcount went from ${prior.length} to ${current.length} (${hc > 0 ? "+" : ""}${pctText(hc)}), beyond the ${policy.headcountPct}% limit.`,
    });
  }

  const priorNet = prior.reduce((a, p) => a + kobo(p.net), 0);
  const currentNet = current.reduce((a, p) => a + kobo(p.net), 0);
  const tn = pctChange(priorNet, currentNet);
  if (tn !== null && Math.abs(tn) > policy.totalPct) {
    out.push({
      code: "TOTAL_NET_VARIANCE",
      employeeId: null,
      message: `Total net pay went from ${money(priorNet)} to ${money(currentNet)} (${tn > 0 ? "+" : ""}${pctText(tn)}), beyond the ${policy.totalPct}% limit.`,
    });
  }

  const before = new Map(prior.map((p) => [p.id, p]));
  for (const c of current) {
    const p = before.get(c.id);
    if (!p || joiners.has(c.id) || leavers.has(c.id)) continue;
    const delta = kobo(c.net) - kobo(p.net);
    if (Math.abs(delta) < kobo(policy.minAmount)) continue;
    const pc = pctChange(kobo(p.net), kobo(c.net));
    if (pc !== null && Math.abs(pc) <= policy.employeePct) continue;
    out.push({
      code: "EMPLOYEE_NET_VARIANCE",
      employeeId: c.id,
      message: `${c.label}: net pay went from ${money(kobo(p.net))} to ${money(kobo(c.net))} (${pc === null ? "was nil" : `${pc > 0 ? "+" : ""}${pctText(pc)}`}).`,
    });
  }
  return out;
}

export type ReconciliationBridge = {
  hasPrior: boolean;
  priorHeadcount: number;
  currentHeadcount: number;
  joiners: PayPerson[];
  leavers: PayPerson[];
  /** In this payroll but not the last, and not a joiner: someone returning, or a missed payment last time. Needs a word. */
  otherAdded: PayPerson[];
  /** In the last payroll but not this one, and not a leaver: someone left out. Needs a word. */
  otherRemoved: PayPerson[];
  net: { prior: number; joiners: number; leavers: number; otherAdded: number; otherRemoved: number; continuing: number; current: number };
  gross: { prior: number; joiners: number; leavers: number; otherAdded: number; otherRemoved: number; continuing: number; current: number };
  /** The bridge adds up: always true unless the inputs are inconsistent. */
  balanced: boolean;
};

const sumK = (xs: PayPerson[], f: "net" | "gross") => xs.reduce((a, p) => a + kobo(p[f]), 0);
/** Kobo to naira, without a negative zero. */
const nairaOf = (k: number) => k / 100 + 0;

/** Walks the previous payroll to this one: who joined, who left, who is unexplained, and what continuing staff changed by. Amounts in naira. */
export function reconcile(input: Compare): ReconciliationBridge {
  const { prior, current, joiners, leavers } = input;
  const before = new Map(prior.map((p) => [p.id, p]));
  const now = new Map(current.map((p) => [p.id, p]));
  const added = current.filter((c) => !before.has(c.id));
  const removed = prior.filter((p) => !now.has(p.id));
  const j = added.filter((p) => joiners.has(p.id));
  const oa = added.filter((p) => !joiners.has(p.id));
  const l = removed.filter((p) => leavers.has(p.id));
  const or = removed.filter((p) => !leavers.has(p.id));
  const continuing = current.filter((c) => before.has(c.id));

  const build = (f: "net" | "gross") => {
    const priorK = sumK(prior, f);
    const currentK = sumK(current, f);
    const cont = continuing.reduce((a, c) => a + kobo(c[f]) - kobo(before.get(c.id)![f]), 0);
    const parts = { joiners: sumK(j, f), leavers: -sumK(l, f), otherAdded: sumK(oa, f), otherRemoved: -sumK(or, f), continuing: cont };
    const ok = priorK + parts.joiners + parts.leavers + parts.otherAdded + parts.otherRemoved + parts.continuing === currentK;
    return { ok, values: { prior: nairaOf(priorK), joiners: nairaOf(parts.joiners), leavers: nairaOf(parts.leavers), otherAdded: nairaOf(parts.otherAdded), otherRemoved: nairaOf(parts.otherRemoved), continuing: nairaOf(parts.continuing), current: nairaOf(currentK) } };
  };
  const net = build("net");
  const gross = build("gross");
  return {
    hasPrior: prior.length > 0,
    priorHeadcount: prior.length,
    currentHeadcount: current.length,
    joiners: j,
    leavers: l,
    otherAdded: oa,
    otherRemoved: or,
    net: net.values,
    gross: gross.values,
    balanced: net.ok && gross.ok && prior.length + added.length - removed.length === current.length,
  };
}
