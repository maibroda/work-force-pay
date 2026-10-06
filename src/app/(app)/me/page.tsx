import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { employeeLocationHistory } from "@/server/services/operations";
import { employeePayslips } from "@/server/services/payroll";
import { myLeave } from "@/server/services/leave";
import { d, fmtDate, fmtShort, iso, monthEnd, monthStart, MONTHS } from "@/lib/dates";
import { naira } from "@/lib/money";
import { employeePensionYtd } from "@/lib/pension-summary";
import { fullName } from "@/lib/utils";
import { Empty } from "@/components/page";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";

/** Mobile-first employee self-service dashboard. */
export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("self.view");
  const sp = await searchParams;
  if (!ctx.employeeId) return <Empty>Your user account is not linked to an employee record.</Empty>;
  const e = await db.employee.findFirst({
    where: { id: ctx.employeeId, organizationId: ctx.orgId },
    include: { category: true, currentBeat: true, currentClient: true },
  });
  if (!e) return <Empty>Employee record not found.</Empty>;
  const leave = await myLeave(ctx);
  if (!leave) return <Empty>Employee record not found.</Empty>;
  const slips = await employeePayslips(ctx, e.id);
  const latest = slips[0];
  const [y, m] = sp.month
    ? sp.month.split("-").map(Number)
    : latest
      ? [latest.run.period.year, latest.run.period.month]
      : [new Date().getUTCFullYear(), new Date().getUTCMonth() + 1];
  const locs = await employeeLocationHistory(ctx, e.id, monthStart(y, m), monthEnd(y, m));
  const att = await db.workRegister.groupBy({
    by: ["attendanceStatus"],
    where: {
      organizationId: ctx.orgId,
      employeeId: e.id,
      date: { gte: monthStart(y, m), lte: monthEnd(y, m) },
    },
    _count: { _all: true },
  });
  const deductions = await db.deduction.findMany({
    where: { organizationId: ctx.orgId, employeeId: e.id },
    include: { period: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const pensionYtd = employeePensionYtd(slips, y);
  const lines = (latest?.lines as Array<{ type: string; name: string; amount: number }> | undefined) ?? [];
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">My profile</p>
        <p className="text-lg font-semibold">{fullName(e)}</p>
        <p className="text-sm">
          <code>{e.employeeNumber}</code> · {e.category.name} · <StatusBadge status={e.status} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Current location: {e.currentClient?.name ?? "—"} — {e.currentBeat?.name ?? "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          Bank: {e.bankName} · {e.accountNumber ? `••••${e.accountNumber.slice(-4)}` : "missing"} · Pension
          PIN {e.pensionPin ?? "—"} ({e.pfa ?? "—"})
        </p>
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">My payslip</p>
          {latest && (
            <Link className="text-xs text-primary underline" href={`/payslips/${latest.id}`}>
              Open full payslip
            </Link>
          )}
        </div>
        {latest ? (
          <>
            <p className="text-sm">{latest.run.period.name}</p>
            <p className="text-2xl font-bold">{naira(latest.netPay)}</p>
            <p className="text-xs text-muted-foreground">
              Gross {naira(latest.totalEarnings)} · PAYE {naira(latest.paye)} · Pension{" "}
              {naira(latest.employeePension)}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No approved payslip yet.</p>
        )}
      </Card>
      <Link href="/me/leave" className="block">
        <Card className="p-4 hover:bg-muted/40">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">My annual leave</p>
            <span className="text-xs text-primary underline">Apply / view</span>
          </div>
          {leave.balance.due ? (
            <p className="text-lg font-semibold">
              {leave.balance.remaining}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                of {leave.balance.entitled} working days left
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Falls due on {fmtDate(leave.balance.nextDueDate)}</p>
          )}
        </Card>
      </Link>
      <Card className="p-4">
        <p className="mb-1 text-xs text-muted-foreground">
          My locations — {MONTHS[m - 1]} {y}
        </p>
        {locs.length ? (
          <ul className="space-y-1 text-sm">
            {locs.map((l, i) => (
              <li key={i} className="flex justify-between">
                <span>
                  <span className="font-mono text-xs">
                    {fmtShort(d(l.from))}–{fmtShort(d(l.to))}
                  </span>{" "}
                  {l.clientName} — {l.beatName}
                </span>
                <Badge tone="blue">{l.days}d</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No records.</p>
        )}
        <form className="mt-2 flex gap-2 text-xs" method="get">
          <input
            type="month"
            name="month"
            defaultValue={`${y}-${String(m).padStart(2, "0")}`}
            className="rounded border px-2 py-1"
          />
          <button className="rounded border px-2">Show</button>
        </form>
      </Card>
      <Card className="p-4">
        <p className="mb-1 text-xs text-muted-foreground">
          My attendance — {MONTHS[m - 1]} {y}
        </p>
        <div className="flex flex-wrap gap-1">
          {att.map((a) => (
            <span key={a.attendanceStatus}>
              <StatusBadge status={a.attendanceStatus} /> {a._count._all}
            </span>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <p className="mb-1 text-xs text-muted-foreground">My salary (latest)</p>
        {lines
          .filter((l) => l.type === "EARNING")
          .map((l, i) => (
            <p key={i} className="flex justify-between text-sm">
              <span>{l.name}</span>
              <span>{naira(l.amount)}</span>
            </p>
          ))}
      </Card>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Pension deducted from my pay ({y})</p>
        <p className="text-lg font-semibold">{naira(pensionYtd)}</p>
        <p className="text-xs text-muted-foreground">Your contributions so far this year. Your full retirement savings balance is on your PFA statement.</p>
      </Card>
      <Card className="p-4">
        <p className="mb-1 text-xs text-muted-foreground">My deductions</p>
        {deductions.length ? (
          deductions.map((x) => (
            <p key={x.id} className="flex justify-between text-sm">
              <span>
                {x.period.name} · {x.deductionType.toLowerCase()} — {x.reason}
              </span>
              <span>{naira(x.amount)}</span>
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">None.</p>
        )}
      </Card>
      <Card className="p-4">
        <p className="mb-1 text-xs text-muted-foreground">Payslip history</p>
        {slips.map((s) => (
          <Link key={s.id} href={`/payslips/${s.id}`} className="flex justify-between border-t py-1 text-sm">
            <span>
              {s.run.period.name}
              {s.run.type === "SUPPLEMENTARY" ? " (supp.)" : ""}
            </span>
            <span>{naira(s.netPay)}</span>
          </Link>
        ))}
      </Card>
      <p className="text-center text-[10px] text-muted-foreground">As at {fmtDate(iso(new Date()))}</p>
    </div>
  );
}
