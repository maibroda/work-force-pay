/**
 * Pure rules for importing employees from a CSV file. No database here.
 *
 * The file is parsed, its columns recognised by name (case and spacing do not matter), and every row checked on its own and against
 * the other rows and the people already on the books. A row with an error is never imported; a warning is something payroll will
 * complain about later (no bank details, no pension PIN) but does not stop the row. Dates are day-first (31/12/1990) or ISO (1990-12-31).
 */

export const MAX_IMPORT_ROWS = 1000;

export type ImportKey =
  | "firstName"
  | "middleName"
  | "lastName"
  | "gender"
  | "dateOfBirth"
  | "phone"
  | "email"
  | "address"
  | "employmentDate"
  | "category"
  | "department"
  | "bankName"
  | "accountNumber"
  | "accountName"
  | "taxId"
  | "pensionPin"
  | "pfa"
  | "annualRent";

export const IMPORT_COLUMNS: { key: ImportKey; header: string; required: boolean; aliases: string[]; example: string; help: string }[] = [
  { key: "firstName", header: "First Name", required: true, aliases: ["firstname", "forename", "givenname"], example: "Chinedu", help: "Required" },
  { key: "middleName", header: "Middle Name", required: false, aliases: ["middlename", "othernames"], example: "", help: "" },
  { key: "lastName", header: "Last Name", required: true, aliases: ["lastname", "surname", "familyname"], example: "Okafor", help: "Required" },
  { key: "gender", header: "Gender", required: false, aliases: ["gender", "sex"], example: "Male", help: "Male / Female (or M / F)" },
  { key: "dateOfBirth", header: "Date of Birth", required: false, aliases: ["dateofbirth", "dob", "birthdate"], example: "14/03/1990", help: "DD/MM/YYYY or YYYY-MM-DD" },
  { key: "phone", header: "Phone", required: false, aliases: ["phone", "phonenumber", "mobile", "telephone"], example: "08031234567", help: "" },
  { key: "email", header: "Email", required: false, aliases: ["email", "emailaddress"], example: "", help: "" },
  { key: "address", header: "Address", required: false, aliases: ["address", "homeaddress"], example: "", help: "" },
  { key: "employmentDate", header: "Employment Date", required: true, aliases: ["employmentdate", "datejoined", "startdate", "dateofemployment", "joindate"], example: "01/02/2026", help: "Required. DD/MM/YYYY or YYYY-MM-DD" },
  { key: "category", header: "Category", required: true, aliases: ["category", "employeecategory", "grade", "jobcategory"], example: "GUARD", help: "Required. Category code or name, as set up for this client" },
  { key: "department", header: "Department", required: false, aliases: ["department", "dept"], example: "", help: "Department code or name" },
  { key: "bankName", header: "Bank Name", required: false, aliases: ["bankname", "bank"], example: "GTBank", help: "" },
  { key: "accountNumber", header: "Account Number", required: false, aliases: ["accountnumber", "accountno", "acctnumber", "acctno", "nuban"], example: "0123456789", help: "10 digits" },
  { key: "accountName", header: "Account Name", required: false, aliases: ["accountname", "acctname"], example: "CHINEDU OKAFOR", help: "" },
  { key: "taxId", header: "Tax ID", required: false, aliases: ["taxid", "tin", "taxidentificationnumber"], example: "", help: "" },
  { key: "pensionPin", header: "Pension PIN", required: false, aliases: ["pensionpin", "pin", "rsapin"], example: "PEN100200300400", help: "" },
  { key: "pfa", header: "PFA", required: false, aliases: ["pfa", "pensionfundadministrator"], example: "Stanbic IBTC Pension", help: "" },
  { key: "annualRent", header: "Annual Rent", required: false, aliases: ["annualrent", "rent"], example: "", help: "Naira, for rent relief" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ─────────────────────────────── CSV ───────────────────────────────

/** Parses CSV text: quoted fields, doubled quotes, commas and line breaks inside quotes, a leading byte-order mark, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      any = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      any = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      if (any || field !== "") {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = "";
      any = false;
    } else {
      field += c;
      any = true;
    }
  }
  if (any || field !== "") {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** One CSV field, quoted when it needs to be. */
export function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function importTemplateCsv(): string {
  const head = IMPORT_COLUMNS.map((c) => csvField(c.header)).join(",");
  const example = IMPORT_COLUMNS.map((c) => csvField(c.example)).join(",");
  return `${head}\r\n${example}\r\n`;
}

// ─────────────────────────────── Headers ───────────────────────────────

export type HeaderMap = { byIndex: (ImportKey | null)[]; unknown: string[]; missingRequired: string[] };

export function mapHeaders(header: string[]): HeaderMap {
  const lookup = new Map<string, ImportKey>();
  for (const c of IMPORT_COLUMNS) {
    lookup.set(norm(c.header), c.key);
    for (const a of c.aliases) lookup.set(a, c.key);
  }
  const seen = new Set<ImportKey>();
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
  const missingRequired = IMPORT_COLUMNS.filter((c) => c.required && !seen.has(c.key)).map((c) => c.header);
  return { byIndex, unknown, missingRequired };
}

// ─────────────────────────────── Values ───────────────────────────────

/** A real calendar date from DD/MM/YYYY, D-M-YYYY or YYYY-MM-DD, as YYYY-MM-DD; null if it is not one. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Digits only, with +234 / 234 turned into a leading 0, so the same number written two ways compares equal. */
export function normalizePhone(s: string): string {
  const digits = s.replace(/\D/g, "");
  return digits.startsWith("234") && digits.length === 13 ? `0${digits.slice(3)}` : digits;
}

const nameKey = (a: string, b: string) => (a + b).toLowerCase().replace(/[^a-z]/g, "");

export type ExistingPerson = {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  accountNumber: string | null;
  taxId: string | null;
  pensionPin: string | null;
  phone: string | null;
  dateOfBirth: string | null;
};

export type Lookup = { id: string; code: string | null; name: string };

export type ImportRowResult = {
  /** Line in the file (the header is line 1). */
  line: number;
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
  /** Ready for the employee service when there are no errors. */
  employee?: {
    firstName: string;
    middleName?: string;
    lastName: string;
    gender?: "MALE" | "FEMALE";
    dateOfBirth?: string;
    phone?: string;
    email?: string;
    address?: string;
    employmentDate: string;
    categoryId: string;
    departmentId?: string;
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    taxId?: string;
    pensionPin?: string;
    pfa?: string;
    annualRent?: number;
  };
};

function find(list: Lookup[], v: string): Lookup | undefined {
  const k = norm(v);
  return list.find((l) => (l.code && norm(l.code) === k) || norm(l.name) === k);
}

export type ImportCheck = {
  fatal: string | null;
  headers: HeaderMap | null;
  rows: ImportRowResult[];
  summary: { total: number; ok: number; warnings: number; errors: number };
};

/** Checks a whole file. `today` is YYYY-MM-DD. */
export function checkImport(
  csv: string,
  ref: { categories: Lookup[]; departments: Lookup[]; existing: ExistingPerson[]; today: string; /** Whether a bank name can be turned into a bank code for the payment file. */ knownBank?: (name: string) => boolean },
): ImportCheck {
  const empty = (fatal: string): ImportCheck => ({ fatal, headers: null, rows: [], summary: { total: 0, ok: 0, warnings: 0, errors: 0 } });
  const table = parseCsv(csv);
  if (table.length < 2) return empty("The file has no rows. It needs a header row and at least one employee.");
  const headers = mapHeaders(table[0]);
  if (headers.missingRequired.length) return { ...empty(`The file is missing required column(s): ${headers.missingRequired.join(", ")}.`), headers };
  const body = table.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (body.length > MAX_IMPORT_ROWS) return { ...empty(`The file has ${body.length} rows; the limit is ${MAX_IMPORT_ROWS} per import. Split it.`), headers };

  // keys already taken, by people on the books (active staff only matter for payroll, but a leaver's number can't be reused either)
  const takenAccount = new Map<string, string>();
  const takenTax = new Map<string, string>();
  const takenPin = new Map<string, string>();
  const takenPhone = new Map<string, string>();
  const takenName = new Map<string, string>();
  for (const p of ref.existing) {
    if (p.accountNumber) takenAccount.set(p.accountNumber, p.employeeNumber);
    if (p.taxId) takenTax.set(p.taxId.toLowerCase(), p.employeeNumber);
    if (p.pensionPin) takenPin.set(p.pensionPin.toLowerCase(), p.employeeNumber);
    if (p.phone) takenPhone.set(normalizePhone(p.phone), p.employeeNumber);
    if (p.dateOfBirth) takenName.set(`${nameKey(p.firstName, p.lastName)}|${p.dateOfBirth}`, p.employeeNumber);
  }
  const inFile = { account: new Map<string, number>(), tax: new Map<string, number>(), pin: new Map<string, number>(), phone: new Map<string, number>(), name: new Map<string, number>() };

  const rows: ImportRowResult[] = body.map((cells, i) => {
    const raw: Record<string, string> = {};
    headers.byIndex.forEach((k, idx) => {
      if (k) raw[k] = (cells[idx] ?? "").trim();
    });
    const get = (k: ImportKey) => raw[k] ?? "";
    const line = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!get("firstName")) errors.push("First name is missing.");
    if (!get("lastName")) errors.push("Last name is missing.");

    let gender: "MALE" | "FEMALE" | undefined;
    if (get("gender")) {
      const g = get("gender").toLowerCase();
      if (g === "m" || g === "male") gender = "MALE";
      else if (g === "f" || g === "female") gender = "FEMALE";
      else errors.push(`Gender "${get("gender")}" is not Male or Female.`);
    }

    let dateOfBirth: string | undefined;
    if (get("dateOfBirth")) {
      const dob = parseDate(get("dateOfBirth"));
      if (!dob) errors.push(`Date of birth "${get("dateOfBirth")}" is not a date (use DD/MM/YYYY).`);
      else {
        dateOfBirth = dob;
        const age = (Date.parse(ref.today) - Date.parse(dob)) / (365.25 * 86400000);
        if (age < 0) errors.push("Date of birth is in the future.");
        else if (age < 16 || age > 75) warnings.push(`Date of birth makes this person ${Math.floor(age)} years old. Check it.`);
      }
    }

    let employmentDate = "";
    if (!get("employmentDate")) errors.push("Employment date is missing.");
    else {
      const ed = parseDate(get("employmentDate"));
      if (!ed) errors.push(`Employment date "${get("employmentDate")}" is not a date (use DD/MM/YYYY).`);
      else {
        employmentDate = ed;
        if (ed > ref.today) warnings.push("Employment date is in the future.");
        if (dateOfBirth && ed < dateOfBirth) errors.push("Employment date is before the date of birth.");
      }
    }

    const cat = get("category") ? find(ref.categories, get("category")) : undefined;
    if (!get("category")) errors.push("Category is missing.");
    else if (!cat) errors.push(`Category "${get("category")}" is not one of: ${ref.categories.map((c) => c.code ?? c.name).join(", ") || "(none set up)"}.`);

    let dep: Lookup | undefined;
    if (get("department")) {
      dep = find(ref.departments, get("department"));
      if (!dep) errors.push(`Department "${get("department")}" is not one of: ${ref.departments.map((c) => c.code ?? c.name).join(", ") || "(none set up)"}.`);
    }

    if (get("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get("email"))) errors.push(`Email "${get("email")}" is not valid.`);

    let annualRent: number | undefined;
    if (get("annualRent")) {
      const n = Number(get("annualRent").replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) errors.push(`Annual rent "${get("annualRent")}" is not an amount.`);
      else annualRent = n;
    }

    const account = get("accountNumber").replace(/\s/g, "");
    if (account && !/^\d{10}$/.test(account)) errors.push(`Account number "${get("accountNumber")}" must be 10 digits.`);
    if (!account && !get("bankName")) warnings.push("No bank details: this person can't be paid until they are added.");
    else {
      if (account && !get("bankName")) warnings.push("Account number without a bank name.");
      if (!account && get("bankName")) warnings.push("Bank name without an account number.");
      if (account && !get("accountName")) warnings.push("Account number without an account name.");
    }
    if (get("bankName") && ref.knownBank && !ref.knownBank(get("bankName"))) warnings.push(`Bank "${get("bankName")}" is not in the bank list, so this person can't go in the bank payment file until the list or the name is put right.`);
    if (!get("pensionPin") || !get("pfa")) warnings.push("Pension PIN or PFA is missing.");
    if (!get("taxId")) warnings.push("Tax ID is missing.");

    const phone = get("phone") ? normalizePhone(get("phone")) : "";
    if (get("phone") && !/^0\d{10}$/.test(phone)) warnings.push(`Phone "${get("phone")}" is not an 11-digit Nigerian number.`);

    // duplicates against the books, then against earlier rows of this file
    const dup = (label: string, existing: string | undefined, fileLine: number | undefined, severe: boolean) => {
      const msg = existing ? `${label} is already held by ${existing}.` : fileLine ? `${label} also appears on line ${fileLine}.` : null;
      if (msg) (severe ? errors : warnings).push(msg);
    };
    if (account) {
      dup("Account number", takenAccount.get(account), inFile.account.get(account), true);
      if (!inFile.account.has(account)) inFile.account.set(account, line);
    }
    if (get("taxId")) {
      const k = get("taxId").toLowerCase();
      dup("Tax ID", takenTax.get(k), inFile.tax.get(k), true);
      if (!inFile.tax.has(k)) inFile.tax.set(k, line);
    }
    if (get("pensionPin")) {
      const k = get("pensionPin").toLowerCase();
      dup("Pension PIN", takenPin.get(k), inFile.pin.get(k), true);
      if (!inFile.pin.has(k)) inFile.pin.set(k, line);
    }
    if (phone) {
      dup("Phone number", takenPhone.get(phone), inFile.phone.get(phone), false);
      if (!inFile.phone.has(phone)) inFile.phone.set(phone, line);
    }
    if (get("firstName") && get("lastName") && dateOfBirth) {
      const k = `${nameKey(get("firstName"), get("lastName"))}|${dateOfBirth}`;
      dup("Someone with this name and date of birth", takenName.get(k), inFile.name.get(k), true);
      if (!inFile.name.has(k)) inFile.name.set(k, line);
    }

    const result: ImportRowResult = { line, raw, errors, warnings };
    if (!errors.length && cat) {
      result.employee = {
        firstName: get("firstName"),
        ...(get("middleName") ? { middleName: get("middleName") } : {}),
        lastName: get("lastName"),
        ...(gender ? { gender } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(get("phone") ? { phone: get("phone") } : {}),
        ...(get("email") ? { email: get("email") } : {}),
        ...(get("address") ? { address: get("address") } : {}),
        employmentDate,
        categoryId: cat.id,
        ...(dep ? { departmentId: dep.id } : {}),
        ...(get("bankName") ? { bankName: get("bankName") } : {}),
        ...(account ? { accountNumber: account } : {}),
        ...(get("accountName") ? { accountName: get("accountName") } : {}),
        ...(get("taxId") ? { taxId: get("taxId") } : {}),
        ...(get("pensionPin") ? { pensionPin: get("pensionPin") } : {}),
        ...(get("pfa") ? { pfa: get("pfa") } : {}),
        ...(annualRent !== undefined ? { annualRent } : {}),
      };
    }
    return result;
  });

  return {
    fatal: null,
    headers,
    rows,
    summary: {
      total: rows.length,
      errors: rows.filter((r) => r.errors.length).length,
      warnings: rows.filter((r) => !r.errors.length && r.warnings.length).length,
      ok: rows.filter((r) => !r.errors.length && !r.warnings.length).length,
    },
  };
}
