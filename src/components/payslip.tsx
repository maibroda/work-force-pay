import { naira, num } from "@/lib/money";
import { d, fmtDate, fmtShort } from "@/lib/dates";

type Line = { type: string; code: string; name: string; amount: number };
type Loc = { clientName: string; beatName: string; days: number; from: string; to: string };

export function Payslip({
  rec,
  orgName,
}: {
  rec: {
    employeeNumber: string;
    employeeName: string;
    departmentName: string | null;
    categoryName: string;
    bankName: string | null;
    accountNumber: string | null;
    pensionPin: string | null;
    pfa: string | null;
    taxId: string | null;
    daysWorked: unknown;
    daysAbsent: number;
    suspensionDays: number;
    overtimeHours: unknown;
    basisDays: number;
    monthlyGross: unknown;
    totalEarnings: unknown;
    totalDeductions: unknown;
    netPay: unknown;
    taxRuleVersion: string;
    hasOverride: boolean;
    lines: unknown;
    locations: unknown;
    run: {
      type: string;
      runNumber: number;
      status: string;
      period: { name: string; startDate: Date; endDate: Date };
    };
  };
  orgName: string;
}) {
  // Only the employee's own earnings and deductions are shown. What the company pays on top (employer pension, ITF,
  // NSITF, insurance…) is stored on the record but belongs in the employer reports, never on a payslip.
  const lines = (rec.lines as Line[]).filter((l) => l.type === "EARNING" || l.type === "DEDUCTION");
  const locs = rec.locations as Loc[];
  const earnings = lines.filter((l) => l.type === "EARNING");
  const deductions = lines.filter((l) => l.type === "DEDUCTION");
  const period = rec.run.period;
  // Merge contiguous ranges into a per-client/beat summary for the "Work Locations" table
  const summary = new Map<string, Loc & { ranges: string[] }>();
  for (const l of locs) {
    const k = `${l.clientName}|${l.beatName}`;
    const s = summary.get(k) ?? { ...l, days: 0, ranges: [] };
    s.days += l.days;
    s.ranges.push(`${fmtShort(d(l.from))}–${fmtShort(d(l.to))}`);
    summary.set(k, s);
  }
  const Row = ({ l }: { l: Line }) => (
    <tr className="border-b last:border-0">
      <td className="py-1 pr-2">{l.name}</td>
      <td className="py-1 text-right tabular-nums">{naira(l.amount)}</td>
    </tr>
  );
  return (
    <div className="print-area mx-auto max-w-3xl rounded-lg border bg-white p-6 text-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-lg font-semibold">{orgName}</p>
          <p className="text-muted-foreground">
            Payslip — {period.name}
            {rec.run.type === "SUPPLEMENTARY" ? ` (Supplementary #${rec.run.runNumber})` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Payroll period {fmtDate(period.startDate)} – {fmtDate(period.endDate)} · status {rec.run.status}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Net pay</p>
          <p className="text-2xl font-bold tabular-nums">{naira(rec.netPay)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-b py-3 sm:grid-cols-3">
        <p>
          <span className="text-muted-foreground">Employee no.:</span> <b>{rec.employeeNumber}</b>
        </p>
        <p>
          <span className="text-muted-foreground">Name:</span> <b>{rec.employeeName}</b>
        </p>
        <p>
          <span className="text-muted-foreground">Department:</span> {rec.departmentName ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Category:</span> {rec.categoryName}
        </p>
        <p>
          <span className="text-muted-foreground">Bank:</span> {rec.bankName ?? "—"}{" "}
          {rec.accountNumber ? `· ${rec.accountNumber}` : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Tax ID:</span> {rec.taxId ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Pension PIN:</span> {rec.pensionPin ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">PFA:</span> {rec.pfa ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Monthly gross (contractual):</span>{" "}
          {naira(rec.monthlyGross)}
        </p>
      </div>
      {rec.hasOverride && (
        <p className="mt-3 rounded bg-violet-50 px-2 py-1 text-xs text-violet-800">
          Employee Salary Override applied this period.
        </p>
      )}
      <div className="grid gap-6 py-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Earnings
          </h4>
          <table className="w-full">
            <tbody>
              {earnings.map((l, i) => (
                <Row key={i} l={l} />
              ))}
            </tbody>
          </table>
          <p className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>Total earnings</span>
            <span className="tabular-nums">{naira(rec.totalEarnings)}</span>
          </p>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Deductions
          </h4>
          <table className="w-full">
            <tbody>
              {deductions.map((l, i) => (
                <Row key={i} l={l} />
              ))}
            </tbody>
          </table>
          <p className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>Total deductions</span>
            <span className="tabular-nums">{naira(rec.totalDeductions)}</span>
          </p>
        </div>
      </div>
      <div className="border-t py-3">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Work locations — {period.name}
        </h4>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Client</th>
              <th>Location (beat)</th>
              <th>Dates</th>
              <th className="text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {[...summary.values()].map((s) => (
              <tr key={s.clientName + s.beatName} className="border-t">
                <td className="py-1">{s.clientName}</td>
                <td>{s.beatName}</td>
                <td className="text-xs">{s.ranges.join(", ")}</td>
                <td className="text-right tabular-nums">{s.days}</td>
              </tr>
            ))}
            <tr className="border-t font-semibold">
              <td className="py-1" colSpan={3}>
                Total
              </td>
              <td className="text-right">{[...summary.values()].reduce((a, s) => a + s.days, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t pt-3 text-xs sm:grid-cols-4">
        <p>
          Days worked: <b>{num(rec.daysWorked)}</b> / {rec.basisDays}
        </p>
        <p>
          Days absent: <b>{rec.daysAbsent}</b>
        </p>
        <p>
          Suspension days: <b>{rec.suspensionDays}</b>
        </p>
        <p>
          Overtime hours: <b>{num(rec.overtimeHours)}</b>
        </p>
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground">
        PAYE computed with rule {rec.taxRuleVersion}.
      </p>
    </div>
  );
}
