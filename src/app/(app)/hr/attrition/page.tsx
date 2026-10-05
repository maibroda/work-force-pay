import { requirePage } from "@/lib/auth/session";
import { attritionReport } from "@/server/services/attrition";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { Input } from "@/components/ui/input";

type Row = { key: string; count: number; pct: number };

const label = (k: string) => (k === "NOT_RECORDED" ? "Not recorded" : k.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()));

function Bars({ rows, tone = "bg-primary/70" }: { rows: Row[]; tone?: string }) {
  if (!rows.length) return <Empty>No leavers in this period.</Empty>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,12rem)_1fr_6rem] items-center gap-3">
          <span className="truncate">{label(r.key)}</span>
          <span className="h-2.5 rounded-full bg-muted">
            <span className={`block h-2.5 rounded-full ${tone}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-xs text-muted-foreground">
            {r.count} · {r.pct}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function AttritionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const r = await attritionReport(ctx, sp.from, sp.to);
  const maxMonth = Math.max(...r.byMonth.map((m) => m.count), 1);
  return (
    <>
      <PageHeader
        title="Attrition report"
        description="Who left, why, when and after how long — from approved exits in the period. Turnover is leavers as a percentage of the average of opening and closing headcount."
      />
      <FilterBar>
        <FilterField label="From">
          <Input type="date" name="from" defaultValue={r.from} />
        </FilterField>
        <FilterField label="To">
          <Input type="date" name="to" defaultValue={r.to} />
        </FilterField>
      </FilterBar>

      <StatGrid cols={4}>
        <Stat label="Leavers" value={r.leavers} sub={`${r.from} to ${r.to}`} />
        <Stat label="Turnover rate" value={`${r.turnoverRate}%`} sub={`${r.annualisedRate}% annualised`} tone={r.annualisedRate > 20 ? "amber" : undefined} />
        <Stat label="Headcount" value={`${r.headcountStart} → ${r.headcountEnd}`} sub={`average ${r.averageHeadcount}`} />
        <Stat label="Average service at exit" value={r.averageTenureYears === null ? "—" : `${r.averageTenureYears} yrs`} />
      </StatGrid>
      <StatGrid cols={4}>
        <Stat label="Voluntary (resignations)" value={r.voluntary} />
        <Stat label="Involuntary (dismissal, absconding)" value={r.involuntary} tone={r.involuntary ? "amber" : undefined} />
        <Stat label="Left within a year of joining" value={r.earlyLeavers} sub={`${r.earlyLeaverPct}% of leavers`} tone={r.earlyLeaverPct >= 30 ? "red" : undefined} />
        <Stat label="Not eligible for rehire" value={r.notEligibleForRehire} />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Why they left">
          <Bars rows={r.byReason} />
        </Section>
        <Section title="How they left">
          <Bars rows={r.byType} tone="bg-violet-500/70" />
        </Section>
        <Section title="Length of service at exit">
          <Bars rows={r.byTenure} tone="bg-amber-500/70" />
        </Section>
        <Section title="By employee category">
          <Bars rows={r.byCategory} tone="bg-emerald-600/70" />
        </Section>
        <Section title="By department">
          <Bars rows={r.byDepartment} tone="bg-sky-600/70" />
        </Section>
        <Section title="By month">
          <ul className="space-y-1.5 text-sm">
            {r.byMonth.map((m) => (
              <li key={m.month} className="grid grid-cols-[5rem_1fr_2rem] items-center gap-3">
                <span className="font-mono text-xs">{m.month}</span>
                <span className="h-2.5 rounded-full bg-muted">
                  <span className="block h-2.5 rounded-full bg-primary/70" style={{ width: `${(m.count / maxMonth) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums text-xs text-muted-foreground">{m.count}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <p className="mb-8 text-xs text-muted-foreground">
        Counts exits that have been approved, by last working day. Leavers with no reason category show as &ldquo;Not recorded&rdquo; — fill it in on the exit (reason category or exit interview) to keep this report meaningful.
      </p>
    </>
  );
}

