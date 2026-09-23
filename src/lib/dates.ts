/** Date helpers. All business dates are handled as UTC midnight to match Postgres DATE columns. */
export function d(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

export function iso(date: Date | string | null | undefined): string {
  if (!date) return "";
  const x = typeof date === "string" ? new Date(date) : date;
  return x.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const x = new Date(date.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function monthEnd(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, daysInMonth(year, month)));
}

export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let x = new Date(from.getTime()); x <= to; x = addDays(x, 1)) out.push(new Date(x.getTime()));
  return out;
}

/** Inclusive overlap test for effective-dated records (null end = open-ended). */
export function isEffective(date: Date, from: Date, to?: Date | null): boolean {
  return from.getTime() <= date.getTime() && (!to || to.getTime() >= date.getTime());
}

export function fmtDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const x = typeof date === "string" ? new Date(date) : date;
  return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtShort(date: Date | string): string {
  const x = typeof date === "string" ? new Date(date) : date;
  return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function periodName(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}
