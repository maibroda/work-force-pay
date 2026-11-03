/**
 * Before a module is removed from a company (directly, or because a change of plan ends it), look for work in progress in it that the removal would strand (step E5a of
 * docs/plans/module-entitlements-e5.md). It only reads: nothing is changed, and nothing of the module's data is ever deleted by a removal.
 *
 * A HARD blocker refuses the change until the work is finished or cancelled (a pay run waiting for approval, a journal waiting to be posted). A SOFT one is reported and the person
 * making the change has to acknowledge it (open deals, pending leave: they stay readable but can no longer be worked). The lists are the ones proposed in the plan, built on the
 * founder's instruction to continue on those recommendations (2026-11-03); they are for the founder to confirm, and each has its own test. Stock issued to employees is not
 * checked yet: "still issued" has no definition in the data, and I will not invent one.
 */
import { MODULE_KEYS, MODULES, type ModuleKey } from "@/lib/entitlements/catalogue";
import { db, type Tx } from "./_base";

export interface Blocker {
  module: ModuleKey;
  kind: "HARD" | "SOFT";
  count: number;
  /** In plain words: how many, of what, and what to do. */
  message: string;
}

const pl = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const be = (n: number) => (n === 1 ? "is" : "are");
const it = (n: number) => (n === 1 ? "it" : "them");
const stays = (n: number) => (n === 1 ? "It stays readable" : "They stay readable");

type Model = "payrollRun" | "paymentBatch" | "journalDocument" | "accountingPeriod" | "purchaseOrder" | "purchaseInvoice" | "clientInvoice" | "crmOpportunity" | "crmAutomationRun" | "leaveRequest" | "onboardingTask" | "exitTask";

interface Spec {
  module: ModuleKey;
  kind: "HARD" | "SOFT";
  model: Model;
  where: (orgId: string) => Record<string, unknown>;
  text: (n: number) => string;
}

const SPECS: Spec[] = [
  { module: "payroll", kind: "HARD", model: "payrollRun", where: (organizationId) => ({ organizationId, status: { in: ["DRAFT", "CALCULATED", "PENDING_APPROVAL", "APPROVED"] } }), text: (n) => `${n} ${pl(n, "pay run")} ${be(n)} still in progress (not yet locked or paid). Finish or cancel ${it(n)} first.` },
  { module: "payroll", kind: "HARD", model: "paymentBatch", where: (organizationId) => ({ organizationId, status: "PENDING" }), text: (n) => `${n} ${pl(n, "payment batch", "payment batches")} ${be(n)} still awaiting confirmation. Confirm or cancel ${it(n)} first.` },
  { module: "accounting", kind: "HARD", model: "journalDocument", where: (organizationId) => ({ organizationId, status: { in: ["SUBMITTED", "APPROVED"] } }), text: (n) => `${n} manual ${pl(n, "journal")} ${be(n)} waiting for approval or posting. Post or reject ${it(n)} first.` },
  { module: "accounting", kind: "HARD", model: "accountingPeriod", where: (organizationId) => ({ organizationId, status: "SOFT_CLOSED" }), text: (n) => `${n} accounting ${pl(n, "period")} ${be(n)} still being closed. Close or reopen ${it(n)} first.` },
  { module: "payables_procurement", kind: "HARD", model: "purchaseOrder", where: (organizationId) => ({ organizationId, status: "PENDING_APPROVAL" }), text: (n) => `${n} purchase ${pl(n, "order")} ${be(n)} waiting for approval. Approve or reject ${it(n)} first.` },
  { module: "payables_procurement", kind: "HARD", model: "purchaseInvoice", where: (organizationId) => ({ organizationId, matchStatus: "EXCEPTION" }), text: (n) => `${n} supplier ${pl(n, "bill")} that failed ${n === 1 ? "its" : "their"} match ${be(n)} waiting for approval. Approve or reject ${it(n)} first.` },
  { module: "client_billing", kind: "HARD", model: "clientInvoice", where: (organizationId) => ({ organizationId, status: "SUBMITTED" }), text: (n) => `${n} ${pl(n, "invoice")} ${be(n)} waiting for approval. Approve or reject ${it(n)} first.` },
  { module: "client_billing", kind: "SOFT", model: "clientInvoice", where: (organizationId) => ({ organizationId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }), text: (n) => `${n} issued ${pl(n, "invoice")} ${be(n)} not yet fully paid. ${stays(n)}, but can no longer be worked.` },
  { module: "crm", kind: "SOFT", model: "crmOpportunity", where: (organizationId) => ({ organizationId, status: "ACTIVE" }), text: (n) => `${n} ${pl(n, "deal")} ${be(n)} still open. ${stays(n)} but can no longer be worked.` },
  { module: "crm", kind: "SOFT", model: "crmAutomationRun", where: (organizationId) => ({ organizationId, status: "PENDING" }), text: (n) => `${n} automation ${pl(n, "step")} ${be(n)} still queued. ${n === 1 ? "It will be cancelled when it falls due." : "They will be cancelled when they fall due."}` },
  { module: "hr", kind: "SOFT", model: "leaveRequest", where: (organizationId) => ({ organizationId, status: "PENDING" }), text: (n) => `${n} leave ${pl(n, "request")} ${be(n)} still pending. ${stays(n)} but cannot be decided once the module ends.` },
  { module: "hr", kind: "SOFT", model: "onboardingTask", where: (organizationId) => ({ organizationId, status: "PENDING" }), text: (n) => `${n} onboarding ${pl(n, "task")} ${be(n)} still open. ${stays(n)} but cannot be completed once the module ends.` },
  { module: "hr", kind: "SOFT", model: "exitTask", where: (organizationId) => ({ organizationId, status: "PENDING" }), text: (n) => `${n} exit ${pl(n, "task")} ${be(n)} still open. ${stays(n)} but cannot be completed once the module ends.` },
];

/** The work in progress that removing these modules from this company would strand: hard and soft, in plain words. `client` is the database (or a transaction), so a change can check inside its own transaction. */
export async function changeBlockers(orgId: string, removing: readonly ModuleKey[], client: Tx = db): Promise<{ hard: Blocker[]; soft: Blocker[] }> {
  const out = { hard: [] as Blocker[], soft: [] as Blocker[] };
  const gone = new Set(removing);
  for (const mod of MODULE_KEYS.filter((k) => gone.has(k))) {
    for (const spec of SPECS.filter((s) => s.module === mod)) {
      const delegate = (client as unknown as Record<Model, { count: (a: { where: Record<string, unknown> }) => Promise<number> }>)[spec.model];
      const count = await delegate.count({ where: spec.where(orgId) });
      if (count > 0) (spec.kind === "HARD" ? out.hard : out.soft).push({ module: mod, kind: spec.kind, count, message: `${MODULES[mod].name}: ${spec.text(count)}` });
    }
  }
  return out;
}
