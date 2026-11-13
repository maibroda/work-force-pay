/**
 * Pure rules for the record of who looked at people's sensitive details (bank, tax and pension identifiers, guarantors and next of kin, payslips,
 * payment files). No database here.
 */

/**
 * Governance step 2a: a read of one of these five records is logged BY THE RECORD (its own reference), never by the employee: the log names who read what, so it cannot reveal that
 * a named person has a welfare case or is on a succession list.
 */
export const RECORD_KINDS = ["WELFARE_CASE", "CONFIDENTIAL_CASE", "DISCIPLINARY_CASE", "SUCCESSION", "IMPROVEMENT_PLAN"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const ACCESS_KINDS = ["IDENTIFIERS", "BANK", "PENSION", "TAX", "PERSONAL_RECORDS", "PAYSLIP", "PAYMENTS", "REPORT", ...RECORD_KINDS] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];

export const isRecordKind = (k: string): k is RecordKind => (RECORD_KINDS as readonly string[]).includes(k);

export const ACCESS_KIND_LABELS: Record<AccessKind, string> = {
  IDENTIFIERS: "An employee's bank, tax and pension details",
  BANK: "Everyone's bank details",
  PENSION: "Everyone's pension details",
  TAX: "Everyone's tax details",
  PERSONAL_RECORDS: "Guarantors, next of kin and dependants",
  PAYSLIP: "A payslip",
  PAYMENTS: "Payment accounts",
  REPORT: "A report with bank, tax or pension columns",
  WELFARE_CASE: "A welfare case",
  CONFIDENTIAL_CASE: "A confidential case (harassment, whistleblowing or marked confidential)",
  DISCIPLINARY_CASE: "A disciplinary case",
  SUCCESSION: "The succession list",
  IMPROVEMENT_PLAN: "A performance improvement plan",
};

/** Opening the same thing again within this many minutes is one entry, so refreshing a page doesn't flood the record. */
export const DEDUPE_MINUTES = 10;

/** Someone opening this many different employees' details in a single day is worth a second look. */
export const UNUSUAL_EMPLOYEES_PER_DAY = 25;

/** ...and so is opening this many different welfare, confidential, disciplinary, succession or improvement-plan records in a single day. */
export const UNUSUAL_RECORDS_PER_DAY = 10;

/** Report columns that carry bank, tax or pension identifiers. */
export const SENSITIVE_COLUMN_KEYS = ["accountNumber", "pensionPin", "taxId"] as const;

export const isSensitiveReport = (columns: readonly { key: string }[]) => columns.some((c) => (SENSITIVE_COLUMN_KEYS as readonly string[]).includes(c.key));

export interface AccessRow {
  userId: string | null;
  userName: string;
  /** The employee whose details were opened, when it was one person's. */
  employeeId: string | null;
  kind: AccessKind;
  at: Date;
  /** For one of the five record kinds: the record's own reference (a case or plan id). */
  ref?: string | null;
  /** A list or overview of records rather than one record. */
  list?: boolean;
  /** The reader is an outsourced user. */
  external?: boolean;
}

export interface UserAccessSummary {
  userId: string | null;
  userName: string;
  /** Different employees whose details this person opened one at a time. */
  employees: number;
  /** Times they opened a list with everyone's details, or a report or payment file. */
  lists: number;
  lastAt: Date;
  /** Different welfare, confidential, disciplinary, succession or improvement-plan records they opened one at a time. */
  records: number;
  /** An outsourced reader: listed first. */
  external: boolean;
  /** The days on which they opened an unusual number of different employees' details, or of different records. */
  unusualDays: string[];
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function summariseAccess(rows: readonly AccessRow[], limit = UNUSUAL_EMPLOYEES_PER_DAY, recordLimit = UNUSUAL_RECORDS_PER_DAY): UserAccessSummary[] {
  const byUser = new Map<string, AccessRow[]>();
  for (const r of rows) byUser.set(r.userId ?? `name:${r.userName}`, [...(byUser.get(r.userId ?? `name:${r.userName}`) ?? []), r]);
  const out: UserAccessSummary[] = [];
  for (const list of byUser.values()) {
    const single = list.filter((r) => r.employeeId);
    // one record opened on its own (not a list of them): counted once however many times it was opened
    const oneRecord = list.filter((r) => isRecordKind(r.kind) && !r.list && r.ref && !r.employeeId);
    const perDay = new Map<string, Set<string>>();
    for (const r of single) perDay.set(dayOf(r.at), (perDay.get(dayOf(r.at)) ?? new Set()).add(r.employeeId!));
    const recordsPerDay = new Map<string, Set<string>>();
    for (const r of oneRecord) recordsPerDay.set(dayOf(r.at), (recordsPerDay.get(dayOf(r.at)) ?? new Set()).add(r.ref!));
    const unusual = new Set<string>([
      ...[...perDay.entries()].filter(([, s]) => s.size >= limit).map(([day]) => day),
      ...[...recordsPerDay.entries()].filter(([, s]) => s.size >= recordLimit).map(([day]) => day),
    ]);
    out.push({
      userId: list[0].userId,
      userName: list[0].userName,
      employees: new Set(single.map((r) => r.employeeId)).size,
      records: new Set(oneRecord.map((r) => r.ref)).size,
      lists: list.filter((r) => !r.employeeId && !(isRecordKind(r.kind) && !r.list && r.ref)).length,
      lastAt: new Date(Math.max(...list.map((r) => r.at.getTime()))),
      external: list.some((r) => r.external),
      unusualDays: [...unusual].sort(),
    });
  }
  // outsourced readers first (the plan promised it), then the people with something unusual, then the busiest
  return out.sort(
    (a, b) =>
      Number(b.external) - Number(a.external) ||
      Number(!!b.unusualDays.length) - Number(!!a.unusualDays.length) ||
      b.employees + b.lists + b.records - (a.employees + a.lists + a.records),
  );
}
