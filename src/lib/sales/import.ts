/**
 * Importing leads, accounts and contacts from a CSV, as pure rules (no database): read the headers, check every row, and say what is wrong with each
 * before anything is saved. Phones are normalised to +234 form, emails to lower case, choices (source, service, role) are matched by their names in any
 * case. Consent is only recorded when the file says so AND says where it came from. A file may hold up to 1,000 rows.
 */
import { csvField, parseCsv } from "@/lib/employee-import";
import { businessEmailDomain } from "./duplicates";
import { normalizeCompanyName } from "./names";
import { normalizeNgPhone } from "./phone";

export const MAX_IMPORT_ROWS = 1000;
export type ImportKind = "LEADS" | "ACCOUNTS" | "CONTACTS";
export const IMPORT_KINDS: ImportKind[] = ["LEADS", "ACCOUNTS", "CONTACTS"];

export const SOURCES = ["REFERRAL", "WALK_IN", "PHONE", "WEBSITE", "WHATSAPP", "TENDER", "EVENT", "EXISTING_CLIENT", "OTHER"] as const;
export const SERVICES = ["GUARDING", "CLEANING", "FACILITY", "STAFFING", "OTHER"] as const;
export const ACCOUNT_TYPES = ["PROSPECT", "CLIENT", "FORMER_CLIENT"] as const;
export const DECISION_ROLES = ["DECISION_MAKER", "INFLUENCER", "USER", "FINANCE", "PROCUREMENT", "GATEKEEPER"] as const;

type Column = { key: string; header: string; required: boolean; aliases: string[]; example: string };
const col = (key: string, header: string, required: boolean, example: string, aliases: string[] = []): Column => ({ key, header, required, example, aliases });

export const COLUMNS: Record<ImportKind, Column[]> = {
  LEADS: [
    col("companyName", "Company", true, "Lekki Gardens Estate", ["company name", "name", "organisation", "organization"]),
    col("contactName", "Contact Person", false, "Ngozi Okoro", ["contact", "contact name", "person"]),
    col("jobTitle", "Job Title", false, "Facility Manager", ["title", "position", "role"]),
    col("phone", "Phone", false, "0803 123 4567", ["phone number", "mobile", "telephone"]),
    col("email", "Email", false, "ngozi@lekkigardens.example", ["email address", "e-mail"]),
    col("industry", "Industry", false, "Real estate", []),
    col("state", "State", false, "Lagos", []),
    col("lga", "LGA", false, "Eti-Osa", ["local government"]),
    col("address", "Address", false, "1 Admiralty Way", []),
    col("source", "Source", false, "Referral", ["lead source"]),
    col("sourceDetail", "Source Detail", false, "Referred by Mr Bello", ["source details"]),
    col("serviceInterest", "Service Wanted", false, "Guarding", ["service", "service interest"]),
    col("estimatedGuards", "Estimated Guards", false, "18", ["guards", "number of guards"]),
    col("marketingConsent", "Marketing Consent", false, "Yes", ["consent", "marketing"]),
    col("consentSource", "Consent Source", false, "Web form 12 Oct 2026", ["source of consent"]),
  ],
  ACCOUNTS: [
    col("name", "Company", true, "Lekki Gardens Estate Ltd", ["company name", "name", "account", "organisation", "organization"]),
    col("industry", "Industry", false, "Real estate", []),
    col("accountType", "Type", false, "Prospect", ["account type"]),
    col("state", "State", false, "Lagos", []),
    col("lga", "LGA", false, "Eti-Osa", ["local government"]),
    col("address", "Address", false, "1 Admiralty Way", []),
    col("source", "Source", false, "Referral", []),
    col("sourceDetail", "Source Detail", false, "Referred by Mr Bello", []),
    col("rcNumber", "RC Number", false, "RC123456", ["rc", "registration number"]),
    col("emailDomain", "Email Domain", false, "lekkigardens.example", ["domain"]),
  ],
  CONTACTS: [
    col("firstName", "First Name", true, "Ngozi", ["first"]),
    col("lastName", "Last Name", true, "Okoro", ["surname", "last"]),
    col("accountName", "Account", false, "Lekki Gardens Estate Ltd", ["company", "company name"]),
    col("jobTitle", "Job Title", false, "Facility Manager", ["title", "position"]),
    col("roleInDecision", "Role In Decision", false, "Decision Maker", ["decision role", "role"]),
    col("phone", "Phone", false, "0803 123 4567", ["phone number", "mobile"]),
    col("whatsapp", "WhatsApp", false, "0803 123 4567", ["whatsapp number"]),
    col("email", "Email", false, "ngozi@lekkigardens.example", ["email address"]),
    col("marketingConsent", "Marketing Consent", false, "", ["consent", "marketing"]),
    col("consentSource", "Consent Source", false, "", ["source of consent"]),
  ],
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export type HeaderMap = { byIndex: (string | null)[]; unknown: string[]; missingRequired: string[] };

export function mapHeaders(kind: ImportKind, header: string[]): HeaderMap {
  const cols = COLUMNS[kind];
  const lookup = new Map<string, Column>();
  for (const c of cols) for (const n of [c.header, c.key, ...c.aliases]) lookup.set(squash(n), c);
  const seen = new Set<string>();
  const unknown: string[] = [];
  const byIndex = header.map((h) => {
    const c = lookup.get(squash(h));
    if (!c) {
      if (h.trim()) unknown.push(h.trim());
      return null;
    }
    if (seen.has(c.key)) {
      unknown.push(`${h.trim()} (repeated)`);
      return null;
    }
    seen.add(c.key);
    return c.key;
  });
  return { byIndex, unknown, missingRequired: cols.filter((c) => c.required && !seen.has(c.key)).map((c) => c.header) };
}

/** A choice typed in a file ("Walk in", "walk-in", "WALK_IN") matched to its stored value. */
export function matchChoice<T extends string>(raw: string, allowed: readonly T[]): T | null {
  const k = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (allowed as readonly string[]).includes(k) ? (k as T) : null;
}

const YES = ["yes", "y", "true", "1", "granted", "consented"];
const NO = ["no", "n", "false", "0", "withdrawn", "opted out", "optout"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ImportRow = {
  line: number;
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
  /** The validated values (set only when the row has no error). */
  data?: Record<string, unknown>;
};
export type ImportCheck = {
  kind: ImportKind;
  fatal?: string;
  headers?: HeaderMap;
  rows: ImportRow[];
  summary: { total: number; ok: number; warnings: number; errors: number };
};

/** The label a row is known by in messages. */
export function rowLabel(kind: ImportKind, r: ImportRow): string {
  if (kind === "CONTACTS") return `${r.raw.firstName ?? ""} ${r.raw.lastName ?? ""}`.trim() || "—";
  return r.raw.companyName ?? r.raw.name ?? "—";
}

export function checkImport(kind: ImportKind, text: string): ImportCheck {
  const fail = (fatal: string): ImportCheck => ({ kind, fatal, rows: [], summary: { total: 0, ok: 0, warnings: 0, errors: 0 } });
  const table = parseCsv(text);
  if (!table.length) return fail("The file is empty.");
  const headers = mapHeaders(kind, table[0]);
  if (headers.missingRequired.length) return fail(`The file is missing required column(s): ${headers.missingRequired.join(", ")}. Download the template for the exact columns.`);
  const body = table.slice(1);
  if (!body.length) return fail("The file has headers but no rows.");
  if (body.length > MAX_IMPORT_ROWS) return fail(`The file has ${body.length} rows; the limit is ${MAX_IMPORT_ROWS} per file. Split it and import in parts.`);

  const rows: ImportRow[] = body.map((cells, i) => {
    const raw: Record<string, string> = {};
    headers.byIndex.forEach((key, idx) => {
      if (key) raw[key] = (cells[idx] ?? "").trim();
    });
    const row: ImportRow = { line: i + 2, raw, errors: [], warnings: [] };
    const data: Record<string, unknown> = {};
    const get = (k: string) => (raw[k] ? raw[k] : undefined);

    if (kind === "LEADS" && !get("companyName")) row.errors.push("Company is missing.");
    if (kind === "ACCOUNTS" && !get("name")) row.errors.push("Company is missing.");
    if (kind === "CONTACTS") {
      if (!get("firstName")) row.errors.push("First name is missing.");
      if (!get("lastName")) row.errors.push("Last name is missing.");
    }
    for (const k of ["companyName", "name", "contactName", "firstName", "lastName", "jobTitle", "industry", "state", "lga", "address", "sourceDetail", "rcNumber", "accountName"]) if (get(k)) data[k] = get(k);

    for (const [k, label] of [["phone", "Phone"], ["whatsapp", "WhatsApp"]] as const)
      if (get(k)) {
        const p = normalizeNgPhone(get(k));
        if (p.ok) data[k === "phone" ? "phoneE164" : "whatsappE164"] = p.e164;
        else row.errors.push(`${label}: ${p.reason}`);
      }
    if (get("email")) {
      const e = get("email")!.toLowerCase();
      if (EMAIL.test(e)) data.email = e;
      else row.errors.push(`Email "${get("email")}" is not a valid address.`);
    }
    if (get("emailDomain")) data.emailDomain = get("emailDomain")!.toLowerCase().replace(/^@/, "");
    else if (kind === "ACCOUNTS" && data.email) data.emailDomain = businessEmailDomain(String(data.email)) ?? undefined;

    const choice = <T extends string>(k: string, label: string, allowed: readonly T[]) => {
      if (!get(k)) return;
      const m = matchChoice(get(k)!, allowed);
      if (m) data[k] = m;
      else row.errors.push(`${label} "${get(k)}" is not one of: ${allowed.map((a) => a.toLowerCase().replace(/_/g, " ")).join(", ")}.`);
    };
    choice("source", "Source", SOURCES);
    choice("serviceInterest", "Service wanted", SERVICES);
    choice("accountType", "Type", ACCOUNT_TYPES);
    choice("roleInDecision", "Role in the decision", DECISION_ROLES);
    if (get("estimatedGuards")) {
      const n = Number(get("estimatedGuards"));
      if (Number.isInteger(n) && n >= 0 && n <= 100000) data.estimatedGuards = n;
      else row.errors.push(`Estimated guards "${get("estimatedGuards")}" must be a whole number.`);
    }

    // consent is recorded only when the file says so and says where it came from
    if (get("marketingConsent")) {
      const c = get("marketingConsent")!.toLowerCase();
      const status = YES.includes(c) ? "GRANTED" : NO.includes(c) ? "WITHDRAWN" : null;
      if (!status) row.errors.push(`Marketing consent "${get("marketingConsent")}" must be Yes or No (or left empty if unknown).`);
      else if (!get("consentSource") || get("consentSource")!.length < 3) row.errors.push("Marketing consent needs a Consent Source (where the consent came from: the form, call or message).");
      else data.consent = { status, source: get("consentSource") };
    } else if (get("consentSource")) row.warnings.push("Consent Source is given but Marketing Consent is empty, so no consent is recorded.");

    if (!row.errors.length) row.data = data;
    return row;
  });

  // the same person or company twice inside the file
  const firstSeen = new Map<string, number>();
  const note = (key: string, line: number, what: string, row: ImportRow) => {
    const earlier = firstSeen.get(key);
    if (earlier !== undefined) row.warnings.push(`${what} also appears on line ${earlier}.`);
    else firstSeen.set(key, line);
  };
  for (const r of rows) {
    if (!r.data) continue;
    if (kind === "ACCOUNTS") note(`n|${normalizeCompanyName(String(r.data.name))}`, r.line, "This company", r);
    else if (kind === "LEADS") note(`n|${normalizeCompanyName(String(r.data.companyName))}`, r.line, "This company", r);
    if (kind !== "ACCOUNTS") {
      if (r.data.phoneE164) note(`p|${r.data.phoneE164}`, r.line, "This phone number", r);
      if (r.data.email) note(`e|${r.data.email}`, r.line, "This email address", r);
    }
  }

  const errors = rows.filter((r) => r.errors.length).length;
  const warnings = rows.filter((r) => !r.errors.length && r.warnings.length).length;
  return { kind, headers, rows, summary: { total: rows.length, ok: rows.length - errors - warnings, warnings, errors } };
}

/** A cell written safely to CSV: text a spreadsheet would run as a formula (starting = + - @) is made harmless, except a plain +234 phone number. */
export function safeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{8,15}$/.test(s)) return `'${s}`;
  return s;
}
export const csvRow = (cells: unknown[]) => cells.map((c) => csvField(safeCell(c))).join(",");

export function importTemplateCsv(kind: ImportKind): string {
  const cols = COLUMNS[kind];
  return `${csvRow(cols.map((c) => c.header))}\r\n${csvRow(cols.map((c) => c.example))}\r\n`;
}

/** The rows that failed, as a CSV the person can correct and upload again: the original cells plus what was wrong. */
export function errorsCsv(kind: ImportKind, check: ImportCheck): string {
  const cols = COLUMNS[kind];
  const head = csvRow([...cols.map((c) => c.header), "Problems"]);
  const lines = check.rows.filter((r) => r.errors.length).map((r) => csvRow([...cols.map((c) => r.raw[c.key] ?? ""), r.errors.join(" ")]));
  return [head, ...lines].join("\r\n") + "\r\n";
}
