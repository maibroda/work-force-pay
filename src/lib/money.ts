/** Round to kobo (2 dp) using half-away-from-zero. */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toNumber" in v) return (v as { toNumber(): number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}

const ngn = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 });
export function naira(v: unknown): string {
  return ngn.format(num(v)).replace("NGN", "₦");
}

export function compactNaira(v: unknown): string {
  const n = num(v);
  if (Math.abs(n) >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}bn`;
  if (Math.abs(n) >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}m`;
  if (Math.abs(n) >= 1_000) return `₦${(n / 1_000).toFixed(1)}k`;
  return `₦${n.toFixed(0)}`;
}
