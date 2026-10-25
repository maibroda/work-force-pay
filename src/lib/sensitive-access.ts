/**
 * Pure rules for the record of who looked at people's sensitive details (bank, tax and pension identifiers, guarantors and next of kin, payslips,
 * payment files). No database here.
 */

export const ACCESS_KINDS = ["IDENTIFIERS", "BANK", "PENSION", "TAX", "PERSONAL_RECORDS", "PAYSLIP", "PAYMENTS", "REPORT"] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];

export const ACCESS_KIND_LABELS: Record<AccessKind, string> = {
  IDENTIFIERS: "An employee's bank, tax and pension details",
  BANK: "Everyone's bank details",
  PENSION: "Everyone's pension details",
  TAX: "Everyone's tax details",
  PERSONAL_RECORDS: "Guarantors, next of kin and dependants",
  PAYSLIP: "A payslip",
  PAYMENTS: "Payment accounts",
  REPORT: "A report with bank, tax or pension columns",
};

/** Opening the same thing again within this many minutes is one entry, so refreshing a page doesn't flood the record. */
export const DEDUPE_MINUTES = 10;

/** Someone opening this many different employees' details in a single day is worth a second look. */
export const UNUSUAL_EMPLOYEES_PER_DAY = 25;

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
}

export interface UserAccessSummary {
  userId: string | null;
  userName: string;
  /** Different employees whose details this person opened one at a time. */
  employees: number;
  /** Times they opened a list with everyone's details, or a report or payment file. */
  lists: number;
  lastAt: Date;
  /** The days on which they opened an unusual number of different employees' details. */
  unusualDays: string[];
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function summariseAccess(rows: readonly AccessRow[], limit = UNUSUAL_EMPLOYEES_PER_DAY): UserAccessSummary[] {
  const byUser = new Map<string, AccessRow[]>();
  for (const r of rows) byUser.set(r.userId ?? `name:${r.userName}`, [...(byUser.get(r.userId ?? `name:${r.userName}`) ?? []), r]);
  const out: UserAccessSummary[] = [];
  for (const list of byUser.values()) {
    const single = list.filter((r) => r.employeeId);
    const perDay = new Map<string, Set<string>>();
    for (const r of single) perDay.set(dayOf(r.at), (perDay.get(dayOf(r.at)) ?? new Set()).add(r.employeeId!));
    out.push({
      userId: list[0].userId,
      userName: list[0].userName,
      employees: new Set(single.map((r) => r.employeeId)).size,
      lists: list.filter((r) => !r.employeeId).length,
      lastAt: new Date(Math.max(...list.map((r) => r.at.getTime()))),
      unusualDays: [...perDay.entries()].filter(([, s]) => s.size >= limit).map(([day]) => day).sort(),
    });
  }
  // the people with something unusual first, then the busiest
  return out.sort((a, b) => Number(!!b.unusualDays.length) - Number(!!a.unusualDays.length) || b.employees + b.lists - (a.employees + a.lists));
}
