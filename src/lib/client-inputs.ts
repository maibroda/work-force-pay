/**
 * Pure rules for a client's monthly inputs sent as a CSV file: overtime, allowances, bonuses and deductions for named employees.
 * No database here.
 *
 * The file is parsed, its columns recognised by name (case and spacing do not matter), and every row checked on its own, against the
 * rest of the file and against what is already entered for the month. A row with an error stops the file being sent (the client fixes
 * it and sends it again); a warning is something the bureau will want to look at but does not stop it.
 */
import { csvField, parseCsv } from "./employee-import";

export const MAX_INPUT_ROWS = 1000;
/** Above this a row is flagged as unusually large; above the limit it is refused as a likely typing slip. */
export const LARGE_AMOUNT = 1_000_000;
export const MAX_AMOUNT = 50_000_000;

export const EARNING_TYPES = ["OVERTIME", "ALLOWANCE", "BONUS", "OTHER_EARNING"] as const;
export const DEDUCTION_TYPES = ["DEDUCTION", "PENALTY", "RECOVERY", "SALARY_ADVANCE"] as const;
export const INPUT_TYPES = [...EARNING_TYPES, ...DEDUCTION_TYPES] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const INPUT_TYPE_LABELS: Record<InputType, string> = {
  OVERTIME: "Overtime",
  ALLOWANCE: "Allowance",
  BONUS: "Bonus",
  OTHER_EARNING: "Other earning",
  DEDUCTION: "Deduction",
  PENALTY: "Penalty",
  RECOVERY: "Recovery",
  SALARY_ADVANCE: "Salary advance",
};

export const isDeduction = (t: InputType) => (DEDUCTION_TYPES as readonly string[]).includes(t);

/** Which expected input on the month's tracker a row counts towards. */
export const TRACKER_KIND: Record<InputType, "OVERTIME" | "ALLOWANCES" | "DEDUCTIONS"> = {
  OVERTIME: "OVERTIME",
  ALLOWANCE: "ALLOWANCES",
  BONUS: "ALLOWANCES",
  OTHER_EARNING: "ALLOWANCES",
  DEDUCTION: "DEDUCTIONS",
  PENALTY: "DEDUCTIONS",
  RECOVERY: "DEDUCTIONS",
  SALARY_ADVANCE: "DEDUCTIONS",
};

export type InputKey = "employeeNumber" | "type" | "description" | "amount" | "taxable" | "reference" | "note";

export const INPUT_COLUMNS: { key: InputKey; header: string; required: boolean; aliases: string[]; example: string; help: string }[] = [
  { key: "employeeNumber", header: "Employee Number", required: true, aliases: ["employeenumber", "employeeno", "empno", "staffno", "staffnumber", "employeeid"], example: "EMP-000001", help: "Required. As shown on your payslips and employee list" },
  { key: "type", header: "Type", required: true, aliases: ["type", "kind", "category"], example: "Overtime", help: `Required. One of: ${INPUT_TYPES.map((t) => INPUT_TYPE_LABELS[t]).join(", ")}` },
  { key: "description", header: "Description", required: false, aliases: ["description", "details", "name", "item"], example: "Weekend cover, 12 hours", help: "What it is for. Left blank, the type is used" },
  { key: "amount", header: "Amount", required: true, aliases: ["amount", "value", "sum", "total"], example: "45000", help: "Required. Naira, the whole amount for the month (not per hour)" },
  { key: "taxable", header: "Taxable", required: false, aliases: ["taxable", "taxed"], example: "Yes", help: "Earnings only: Yes or No. Left blank, Yes" },
  { key: "reference", header: "Reference", required: false, aliases: ["reference", "authority", "authorityreference", "ref", "approval"], example: "", help: "Required for deductions: the letter, form or agreement that allows it" },
  { key: "note", header: "Note", required: false, aliases: ["note", "notes", "comment", "remarks", "reason"], example: "", help: "" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const TYPE_ALIASES: Record<string, InputType> = {
  overtime: "OVERTIME",
  ot: "OVERTIME",
  allowance: "ALLOWANCE",
  allowances: "ALLOWANCE",
  bonus: "BONUS",
  otherearning: "OTHER_EARNING",
  otherearnings: "OTHER_EARNING",
  earning: "OTHER_EARNING",
  deduction: "DEDUCTION",
  otherdeduction: "DEDUCTION",
  penalty: "PENALTY",
  fine: "PENALTY",
  recovery: "RECOVERY",
  salaryadvance: "SALARY_ADVANCE",
  advance: "SALARY_ADVANCE",
};

export const parseType = (s: string): InputType | null => TYPE_ALIASES[norm(s)] ?? null;

/** Naira, with thousands commas, a currency sign or "NGN" tolerated, at most two decimals. Null if it is not a positive amount. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[₦,\s]/g, "").replace(/^ngn/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

export function parseYesNo(s: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  return null;
}

export function inputTemplateCsv(): string {
  const head = INPUT_COLUMNS.map((c) => csvField(c.header)).join(",");
  const rows = [
    ["EMP-000001", "Overtime", "Weekend cover, 12 hours", "45000", "Yes", "", ""],
    ["EMP-000002", "Allowance", "Transport allowance", "15000", "No", "", ""],
    ["EMP-000003", "Penalty", "Lateness, October", "5000", "", "HR letter dated 14 Oct", ""],
  ];
  return [head, ...rows.map((r) => r.map(csvField).join(","))].join("\r\n") + "\r\n";
}

// ─────────────────────────────── Headers ───────────────────────────────

export type InputHeaderMap = { byIndex: (InputKey | null)[]; unknown: string[]; missingRequired: string[] };

export function mapInputHeaders(header: string[]): InputHeaderMap {
  const lookup = new Map<string, InputKey>();
  for (const c of INPUT_COLUMNS) {
    lookup.set(norm(c.header), c.key);
    for (const a of c.aliases) lookup.set(a, c.key);
  }
  const seen = new Set<InputKey>();
  const unknown: string[] = [];
  const byIndex = header.map((h) => {
    const key = lookup.get(norm(h)) ?? null;
    if (!key) {
      if (h.trim()) unknown.push(h.trim());
      return null;
    }
    if (seen.has(key)) {
      unknown.push(`${h.trim()} (repeated)`);
      return null;
    }
    seen.add(key);
    return key;
  });
  return { byIndex, unknown, missingRequired: INPUT_COLUMNS.filter((c) => c.required && !seen.has(c.key)).map((c) => c.header) };
}

// ─────────────────────────────── Checking ───────────────────────────────

export type InputEmployee = { id: string; employeeNumber: string; name: string; status: string };
/** Something already entered for the month that a row might repeat. */
export type ExistingInput = { employeeId: string; deduction: boolean; name: string; amount: number };

export type CheckedItem = {
  line: number;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  type: InputType;
  description: string;
  amount: number;
  taxable: boolean;
  reference: string | null;
  note: string | null;
};

export type InputRowResult = {
  line: number;
  raw: Partial<Record<InputKey, string>>;
  errors: string[];
  warnings: string[];
  item: CheckedItem | null;
};

export type InputCheck = {
  fatal: string | null;
  headers: InputHeaderMap | null;
  rows: InputRowResult[];
  summary: { total: number; ok: number; warnings: number; errors: number; earnings: number; deductions: number };
};

const LEFT = new Set(["TERMINATED", "RESIGNED", "EXITED", "INACTIVE"]);
/** "emp 000001", "EMP000001" and "EMP-000001" are the same number. */
const numberKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const money = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function checkInputs(csv: string, ref: { employees: InputEmployee[]; existing: ExistingInput[] }): InputCheck {
  const empty = (fatal: string): InputCheck => ({ fatal, headers: null, rows: [], summary: { total: 0, ok: 0, warnings: 0, errors: 0, earnings: 0, deductions: 0 } });
  const table = parseCsv(csv);
  if (table.length < 2) return empty("The file has no rows. It needs a header row and at least one input.");
  const headers = mapInputHeaders(table[0]);
  if (headers.missingRequired.length) return { ...empty(`The file is missing required column(s): ${headers.missingRequired.join(", ")}.`), headers };
  const body = table.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (body.length > MAX_INPUT_ROWS) return { ...empty(`The file has ${body.length} rows; the limit is ${MAX_INPUT_ROWS} per upload. Split it.`), headers };

  const byNumber = new Map(ref.employees.map((e) => [numberKey(e.employeeNumber), e]));
  const seenInFile = new Map<string, number>();
  const rows: InputRowResult[] = body.map((cells, i) => {
    const line = i + 2; // line 1 is the header
    const raw: Partial<Record<InputKey, string>> = {};
    headers.byIndex.forEach((k, ix) => {
      if (k) raw[k] = (cells[ix] ?? "").trim();
    });
    const errors: string[] = [];
    const warnings: string[] = [];

    const number = raw.employeeNumber ?? "";
    const emp = number ? byNumber.get(numberKey(number)) : undefined;
    if (!number) errors.push("Employee number is missing.");
    else if (!emp) errors.push(`No employee with number "${number}" at this client.`);
    else if (LEFT.has(emp.status)) errors.push(`${emp.employeeNumber} ${emp.name} is no longer on the payroll.`);
    else if (emp.status === "SUSPENDED") warnings.push(`${emp.employeeNumber} ${emp.name} is suspended.`);

    const typeText = raw.type ?? "";
    const type = typeText ? parseType(typeText) : null;
    if (!typeText) errors.push("Type is missing.");
    else if (!type) errors.push(`"${typeText}" is not a type we know. Use one of: ${INPUT_TYPES.map((t) => INPUT_TYPE_LABELS[t]).join(", ")}.`);

    const amountText = raw.amount ?? "";
    const amount = amountText ? parseAmount(amountText) : null;
    if (!amountText) errors.push("Amount is missing.");
    else if (amount === null) errors.push(`"${amountText}" is not an amount. Use a positive number in naira, for example 45000 or 45,000.50.`);
    else if (amount > MAX_AMOUNT) errors.push(`${money(amount)} is more than ${money(MAX_AMOUNT)}, which looks like a typing slip. Check the amount.`);
    else if (amount >= LARGE_AMOUNT) warnings.push(`${money(amount)} is unusually large. Check it is right.`);

    const deduction = type ? isDeduction(type) : false;
    const description = (raw.description ?? "").trim() || (type ? INPUT_TYPE_LABELS[type] : "");
    if (description && description.length > 120) errors.push("Description is longer than 120 characters.");

    let taxable = true;
    if (raw.taxable) {
      const t = parseYesNo(raw.taxable);
      if (t === null) errors.push(`Taxable should be Yes or No, not "${raw.taxable}".`);
      else if (deduction) warnings.push("Taxable is ignored for deductions.");
      else taxable = t;
    }

    const reference = (raw.reference ?? "").trim();
    if (deduction && reference.length < 3) errors.push("A deduction needs a reference: the letter, form or agreement that allows it.");

    if (errors.length || !emp || !type || amount === null) return { line, raw, errors, warnings, item: null };

    const key = `${emp.id}|${type}|${description.toLowerCase()}|${amount}`;
    const first = seenInFile.get(key);
    if (first) warnings.push(`Looks like a repeat of line ${first}. If both are right, say how they differ in the description.`);
    else seenInFile.set(key, line);
    if (ref.existing.some((x) => x.employeeId === emp.id && x.deduction === deduction && x.amount === amount && x.name.trim().toLowerCase() === description.toLowerCase()))
      warnings.push(`The same ${deduction ? "deduction" : "earning"} of ${money(amount)} is already entered for this month.`);

    return {
      line,
      raw,
      errors,
      warnings,
      item: { line, employeeId: emp.id, employeeNumber: emp.employeeNumber, employeeName: emp.name, type, description, amount, taxable: deduction ? true : taxable, reference: reference || null, note: (raw.note ?? "").trim() || null },
    };
  });

  const good = rows.filter((r) => r.item);
  const sum = (deduction: boolean) => r2(good.filter((r) => isDeduction(r.item!.type) === deduction).reduce((a, r) => a + r.item!.amount, 0));
  return {
    fatal: null,
    headers,
    rows,
    summary: {
      total: rows.length,
      ok: rows.filter((r) => !r.errors.length && !r.warnings.length).length,
      warnings: rows.filter((r) => !r.errors.length && r.warnings.length).length,
      errors: rows.filter((r) => r.errors.length).length,
      earnings: sum(false),
      deductions: sum(true),
    },
  };
}
