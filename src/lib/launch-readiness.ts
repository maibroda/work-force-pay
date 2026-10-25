/**
 * Pure rules for the bureau's launch checklist: what has to be true before real clients' payroll runs through the app, and how each item is
 * judged from what the app can see. No database here.
 *
 * Some things the app can see for itself (whether the rate tables were verified, whether email is really configured, whether a scheduler
 * is calling the jobs). Others only a person can know (that a bank's upload guide was checked, that a real email arrived); those are
 * confirmed by a bureau manager with a note saying what they did, and the date.
 */

export type CheckStatus = "DONE" | "TODO" | "ATTENTION";
export type CheckResult = { status: CheckStatus; evidence: string[] };

/** The things a person confirms by hand, with what to do. */
export const MANUAL_CHECKS = [
  {
    key: "BANK_CODES",
    title: "Bank codes match each client's bank upload guide",
    how: "Open each client's bank's guide for uploading a payment file and compare it with Payments → Bank codes: the code for each bank the client's staff use, and the file's columns (Name, Account Number, Bank Code, Amount, Payment Description). The codes in the app are a starting list, not a certified one. If a bank rejects the layout, tell us and we add a bank-specific one.",
  },
  {
    key: "PAYSLIP_EMAIL",
    title: "A real payslip email, with its PDF, was received and opened",
    how: "Use “Send me a test email” below to prove the email provider accepts attachments, then email one real payslip from a locked payroll to an address you control and open the PDF. Note who received it and on what device.",
  },
  {
    key: "BACKUP_RESTORE",
    title: "A backup was restored into a scratch database and checked",
    how: "Run `npm run db:backup`, then `npm run db:restore-check -- <the file>`. A backup that has never been restored is a hope, not a backup. Note the file and the date.",
  },
] as const;
export type ManualKey = (typeof MANUAL_CHECKS)[number]["key"];
export const MANUAL_KEYS: readonly string[] = MANUAL_CHECKS.map((c) => c.key);

/** The scheduled jobs, and the one that must be running before the first client goes live. */
export const JOBS = [
  { name: "payroll-reminders", label: "Payroll reminders", required: true },
  { name: "hr-digest", label: "HR digest", required: false },
  { name: "data-retention", label: "Records retention", required: false },
  { name: "journal-reversals", label: "Accrual reversals", required: false },
  { name: "recurring-journals", label: "Recurring journals", required: false },
] as const;
export type JobName = (typeof JOBS)[number]["name"];

/** The reminders run each weekday morning, so over a weekend (and a Monday holiday) up to this long without a run is normal. */
export const SCHEDULER_MAX_AGE_HOURS = 96;

/** What HR and Finance should settle when they verify the starting rate tables; the tables were written from the Act's schedule, not certified. */
export const RATE_POINTS = [
  "PAYE bands: 0% to ₦800,000, then 15%, 18%, 21%, 23% and 25% from ₦50 million, as in the Nigeria Tax Act 2025 schedule from 1 January 2026. Compare each band against the Act and the tax authority's current guidance.",
  "The “minimum wage exemption” (annual gross up to ₦840,000 pays no tax) is an older rule that sits beside the ₦800,000 zero band. Confirm it still applies; if not, remove it, because it excuses tax the bands would charge.",
  "Reliefs in the tables: employee pension, and rent relief of 20% of annual rent up to ₦500,000. Confirm whether other deductions the Act allows (for example NHIS contributions, life assurance premiums, interest on a home loan) should be added; they are not in the tables.",
  "National Housing Fund relief (2.5% of basic) is switched off by default. Decide whether clients' staff contribute and switch it on if so.",
  "Pension: employee 8% and employer 10% on basic, housing and transport, the minimum under the Pension Reform Act 2014. Confirm no client has an agreement for higher rates.",
  "Employer contributions: the statutory ones in the starting table are ITF 1% and NSITF 1%. The other percentages (insurance, uniform kits, recruitment and training, leave reliever, outsourcing allowance) are costing assumptions for a security business, not statutory rates; remove them or set them to zero before verifying the table as a statutory one, and check ITF and NSITF still apply to each client.",
] as const;

// ─────────────────────────────── The environment ───────────────────────────────

export type Env = Record<string, string | undefined>;

export function checkEmail(env: Env): CheckResult {
  const out: string[] = [];
  if (!env.RESEND_API_KEY) out.push("RESEND_API_KEY is not set, so emails are only written to the server log and nobody receives them.");
  const from = env.EMAIL_FROM ?? "";
  if (!from) out.push("EMAIL_FROM is not set, so mail would go out from Resend's test address, which delivers only to the Resend account's own owner.");
  else if (/resend\.dev/i.test(from)) out.push("EMAIL_FROM is Resend's test address, which delivers only to the Resend account's own owner. Verify your own domain with Resend and send from it.");
  return out.length ? { status: "TODO", evidence: out } : { status: "DONE", evidence: [`Sending as ${from}.`] };
}

export function checkAppUrl(env: Env): CheckResult {
  const url = env.APP_URL ?? "";
  if (!url) return { status: "TODO", evidence: ["APP_URL is not set, so links in emails (invitations, reminders, password resets) point to http://localhost:3000."] };
  if (!/^https:\/\//i.test(url)) return { status: "TODO", evidence: [`APP_URL is ${url}. Clients' links must be https.`] };
  if (/\/\/(localhost|127\.|\[::1\])/i.test(url)) return { status: "TODO", evidence: [`APP_URL is ${url}, a local address.`] };
  return { status: "DONE", evidence: [`Links in emails point to ${url}.`] };
}

export function checkSecrets(env: Env): CheckResult {
  const out: string[] = [];
  const auth = env.AUTH_SECRET ?? "";
  if (auth.length < 32) out.push("AUTH_SECRET is missing or shorter than 32 characters.");
  else if (/change-me|ci-only|example|secret-string/i.test(auth)) out.push("AUTH_SECRET is still a placeholder from the example file. Anyone who knows it can sign in as anybody; generate a fresh one.");
  const cron = env.CRON_SECRET ?? "";
  if (cron.length < 16) out.push("CRON_SECRET is missing or shorter than 16 characters, so the scheduled jobs are switched off.");
  return out.length ? { status: "TODO", evidence: out } : { status: "DONE", evidence: ["AUTH_SECRET and CRON_SECRET are set."] };
}

// ─────────────────────────────── The scheduler ───────────────────────────────

export type JobRunRow = { name: string; startedAt: Date; ok: boolean; error: string | null };

const ago = (from: Date, now: Date) => {
  const h = Math.round((now.getTime() - from.getTime()) / 3_600_000);
  return h < 1 ? "less than an hour ago" : h < 48 ? `${h} hour${h === 1 ? "" : "s"} ago` : `${Math.round(h / 24)} days ago`;
};

/** Judged by the reminders job (the one that must run); the others are listed for information. `runs` is each job's most recent run. */
export function checkScheduler(runs: readonly JobRunRow[], now: Date): CheckResult {
  const last = new Map(runs.map((r) => [r.name, r]));
  const lines = JOBS.map((j) => {
    const r = last.get(j.name);
    return `${j.label}${j.required ? " (required)" : ""}: ${r ? `${r.ok ? "ran" : "FAILED"} ${ago(r.startedAt, now)}${r.ok || !r.error ? "" : ` — ${r.error}`}` : "has never run"}.`;
  });
  const main = last.get("payroll-reminders");
  if (!main) return { status: "TODO", evidence: ["Nothing has called the scheduled jobs yet. Set up a daily call to each job endpoint with the CRON_SECRET (see docs/going-live.md).", ...lines] };
  const age = (now.getTime() - main.startedAt.getTime()) / 3_600_000;
  if (!main.ok) return { status: "ATTENTION", evidence: ["The payroll reminders job ran but failed the last time.", ...lines] };
  if (age > SCHEDULER_MAX_AGE_HOURS) return { status: "ATTENTION", evidence: [`The payroll reminders job last ran ${ago(main.startedAt, now)}: the scheduler may have stopped.`, ...lines] };
  return { status: "DONE", evidence: lines };
}

// ─────────────────────────────── The rate tables ───────────────────────────────

export type RuleRow = { label: string; release: "PROPOSED" | "VERIFIED" | "PUBLISHED" | null; verifications: number };

/** `inForce` is every master rule in force today; `missingKinds` are the kinds with none at all. */
export function checkRules(inForce: readonly RuleRow[], missingKinds: readonly string[]): CheckResult {
  const out: string[] = [];
  let todo = false;
  for (const k of missingKinds) {
    out.push(`There is no ${k} rule in force in the bureau's own tables, so there is nothing to give clients.`);
    todo = true;
  }
  for (const r of inForce) {
    if (r.release === "PUBLISHED") continue;
    if (r.release === null) {
      out.push(`${r.label} was never put through verification.`);
      todo = true;
    } else if (r.release === "PROPOSED") out.push(`${r.label} is waiting for HR and Finance (${r.verifications} of 2 signed).`);
    else out.push(`${r.label} is verified by both but not yet published.`);
  }
  if (!out.length) return { status: "DONE", evidence: inForce.map((r) => `${r.label}: verified by HR and Finance and published.`) };
  return { status: todo ? "TODO" : "ATTENTION", evidence: out };
}

export function summarise(items: readonly { status: CheckStatus }[]) {
  const done = items.filter((i) => i.status === "DONE").length;
  return { done, total: items.length, ready: done === items.length && items.length > 0 };
}
