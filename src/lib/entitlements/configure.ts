/**
 * The configurator (step E4a of docs/plans/module-entitlements-e4.md): a salesperson's answers about a prospect become a blueprint, that is, the modules the prospect needs, the plan
 * that fits them best with the add-ons it still needs, the reasons in words, any module that is only partly built, and the limits to record. Pure: no database, no clock, and no prices
 * (those are step E4b). The questions and the plan rule are the founder's, accepted on 2026-11-03 from docs/plans/module-entitlements-e4-questionnaire-draft.md.
 */
import { MODULES, PLANS, type ModuleKey, type PlanKey } from "./catalogue";
import { checkPlan, planModules, resolveModules, type Added } from "./resolve";

export const QUESTIONS = [
  { key: "payroll", module: "payroll", ask: "Do you need us to run payroll: pay, statutory deductions, payslips, bank files?" },
  { key: "hr", module: "hr", ask: "Do you need people records beyond pay: leave, onboarding and exit, appraisals, training, grievances, letters?" },
  { key: "self_service", module: "self_service", ask: "Should your staff see their own payslips and request leave themselves?" },
  { key: "contracts_deployment", module: "contracts_deployment", ask: "Do you place workers at client sites under contracts (security, cleaning, facilities)?" },
  { key: "time_attendance", module: "time_attendance", ask: "Do you track attendance, shifts, rosters and overtime?" },
  { key: "client_billing", module: "client_billing", ask: "Do you invoice your clients and track what they owe?" },
  { key: "client_portal", module: "client_portal", ask: "Should your clients approve payroll and download payslips in a portal?" },
  { key: "crm", module: "crm", ask: "Do you manage sales leads, a pipeline, quotes and client cases?" },
  { key: "accounting", module: "accounting", ask: "Do you keep your books in the app: ledger, journals, tax codes, fixed assets, bank reconciliation?" },
  { key: "payables_procurement", module: "payables_procurement", ask: "Do you buy from suppliers: purchase orders, goods received, supplier bills?" },
  { key: "inventory", module: "inventory", ask: "Do you issue stock, such as uniforms or equipment, to employees?" },
  { key: "analytics", module: "analytics", ask: "Do you want management dashboards: labour cost, client and contract margin?" },
] as const satisfies ReadonlyArray<{ key: string; module: ModuleKey; ask: string }>;

export type QuestionKey = (typeof QUESTIONS)[number]["key"];

export interface Answers {
  /** How many employees will be on payroll: recorded as the employee limit (checked in a later step), not a module. */
  employees: number;
  /** How many sales users, asked only when the CRM is wanted: recorded as the CRM user limit. */
  crmUsers?: number | null;
  /** Each question answered yes; a question left out or false is a no. */
  wants: Partial<Record<QuestionKey, boolean>>;
}

export interface Proposal {
  planKey: PlanKey;
  planName: string;
  /** Needed by the prospect and not in the plan. */
  addOns: ModuleKey[];
  /** In the plan and not needed by the prospect. */
  unrequested: ModuleKey[];
  why: string;
}

export interface Configured {
  ok: boolean;
  /** In plain words; when there are any, nothing is proposed. */
  problems: string[];
  /** Everything the prospect needs once the rules have added what the wanted modules need, the core first. */
  modules: ModuleKey[];
  /** What the rules added beyond what was asked, and why (the core is always on and never listed). */
  reasons: Added[];
  proposed: Proposal | null;
  runnerUp: Proposal | null;
  /** Wanted modules that are only partly built, in plain words, so what the client is told stays honest. */
  notes: string[];
  limits: { employeeLimit: number | null; crmUserLimit: number | null };
}

const PLAN_ORDER = Object.keys(PLANS) as PlanKey[];
const PAYROLL_WITHOUT_SITES =
  "Without Contracts & deployment there is no client contract to take pay from, so each employee needs a pay rate (a monthly gross) set on their record. Payroll then pays them for every day they are employed and splits the gross into components by a salary structure (the company's default unless another is chosen). Check that the default structure suits office staff.";
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1;
const fail = (problems: string[]): Configured => ({ ok: false, problems, modules: [], reasons: [], proposed: null, runnerUp: null, notes: [], limits: { employeeLimit: null, crmUserLimit: null } });
const names = (ks: readonly ModuleKey[]) => ks.map((k) => MODULES[k].name).join(", ");

/**
 * The plan to propose is the one that needs the fewest add-ons plus modules the prospect did not ask for; on a tie, the one with fewer add-ons; then the order of the plans. The
 * runner-up is the next best by the same rule. (The founder's rule, 2026-11-03.)
 */
function rank(modules: readonly ModuleKey[]): Proposal[] {
  return PLAN_ORDER.map((planKey, order) => {
    const inPlan = planModules(planKey);
    const addOns = modules.filter((m) => !inPlan.includes(m));
    const unrequested = inPlan.filter((m) => !modules.includes(m));
    return { order, planKey, planName: PLANS[planKey].name, addOns, unrequested, why: "" };
  })
    .sort((a, b) => a.addOns.length + a.unrequested.length - (b.addOns.length + b.unrequested.length) || a.addOns.length - b.addOns.length || a.order - b.order)
    .map((p) => ({
      planKey: p.planKey,
      planName: p.planName,
      addOns: p.addOns,
      unrequested: p.unrequested,
      why:
        `${p.planName}: ${p.addOns.length ? `needs ${p.addOns.length} add-on${p.addOns.length > 1 ? "s" : ""} (${names(p.addOns)})` : "needs no add-ons"}` +
        `${p.unrequested.length ? ` and includes ${p.unrequested.length} module${p.unrequested.length > 1 ? "s" : ""} the prospect did not ask for (${names(p.unrequested)})` : " and includes nothing the prospect did not ask for"}.`,
    }));
}

export function configureClient(answers: Answers): Configured {
  const problems: string[] = [];
  if (!isCount(answers.employees)) problems.push("The number of employees must be a whole number of 1 or more.");
  const known = new Set<string>(QUESTIONS.map((q) => q.key));
  for (const key of Object.keys(answers.wants)) {
    if (known.has(key)) continue;
    const planned = key in MODULES && MODULES[key as ModuleKey].status === "planned";
    problems.push(planned ? `${MODULES[key as ModuleKey].name} (${key}) is not available yet, so it cannot be offered.` : `There is no question called "${key}".`);
  }
  const wanted = QUESTIONS.filter((q) => answers.wants[q.key] === true);
  if (problems.length === 0 && wanted.length === 0) problems.push("Choose at least one thing the client needs.");
  const wantsCrm = wanted.some((q) => q.key === "crm");
  if (wantsCrm && !isCount(answers.crmUsers)) problems.push("How many sales users will use the CRM? Give a whole number of 1 or more.");
  if (problems.length) return fail(problems);

  const resolved = resolveModules(wanted.map((q) => q.module));
  const ranked = rank(resolved.modules);
  const [proposed, runnerUp] = ranked;
  // the proposal always holds together, because the modules do; checked rather than assumed
  const check = checkPlan(proposed.planKey, proposed.addOns);
  if (!check.ok) return fail(check.problems.map((p) => p.message));
  const notes = resolved.modules.filter((m) => MODULES[m].status === "partial").map((m) => `${MODULES[m].name} is only partly built: ${MODULES[m].assumed ?? "some of it is not built yet."}`);
  // What the payroll engine does (src/server/services/payroll.ts, rates.ts): an employee with a pay rate (a monthly gross set on their record) and no work-register days is paid for every day
  // they are employed ("Head Office"), and the gross is split by a salary structure. A company with no Contracts & deployment has no contract rate, so every employee needs a pay rate.
  // (An earlier version of this note wrongly said payroll could not run without deployment: corrected 2026-11-04.)
  if (resolved.modules.includes("payroll") && !resolved.modules.includes("contracts_deployment")) notes.push(PAYROLL_WITHOUT_SITES);
  return {
    ok: true,
    problems: [],
    modules: resolved.modules,
    reasons: resolved.added,
    proposed,
    runnerUp: runnerUp ?? null,
    notes,
    limits: { employeeLimit: answers.employees, crmUserLimit: wantsCrm ? (answers.crmUsers as number) : null },
  };
}
