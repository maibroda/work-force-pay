import { requirePage } from "@/lib/auth/session";
import { naira } from "@/lib/money";
import { workforceOverview, type PayFigure } from "@/server/services/workforce-overview";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { BarsChart } from "@/components/charts";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/** Money here is whole kobo; this only formats it for the screen. */
const money = (kobo: number) => naira(kobo / 100);

/** Where a figure comes from: Recorded (typed into the system) or Calculated (worked out from records). There is no inferred or estimated figure on this page. */
const Source = ({ kind }: { kind: "RECORDED" | "CALCULATED" }) => <Badge tone={kind === "RECORDED" ? "blue" : "violet"}>{kind === "RECORDED" ? "Recorded" : "Calculated"}</Badge>;

function payText(p: PayFigure, min: number) {
  if (p.kobo !== null) return money(p.kobo);
  return p.reason === "NO_PAYROLL" ? "No payroll run yet" : `Fewer than ${min} with a pay figure`;
}

export default async function WorkforceOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("analytics.view");
  const sp = await searchParams;
  const o = await workforceOverview(ctx, { siteId: sp.site || undefined, categoryId: sp.role || undefined, departmentId: sp.department || undefined, contractType: sp.type || undefined });
  const shownRoles = o.byRole.filter((r) => r.averageGross.kobo !== null);
  const hiddenRoles = o.byRole.length - shownRoles.length;
  const filtered = Boolean(sp.site || sp.role || sp.department || sp.type);

  return (
    <>
      <PageHeader
        title="Workforce overview"
        description={`Who works here and how: headcount, roles, deployment, length of service, contract type and pay. ${o.headcount} ${o.headcount === 1 ? "person" : "people"}${filtered ? " in this view" : ""}. Active and on-leave employees only. Pay is the monthly gross of ${o.payRun ? o.payRun.label : "the latest payroll run (none yet)"}, and an average is shown only for a group of at least ${o.minimumGroup} people with a pay figure, so it can never be one person's pay.`}
      />

      <FilterBar action="/analytics/workforce">
        <FilterField label="Deployment site">
          <Select name="site" defaultValue={sp.site ?? ""}>
            <option value="">All sites</option>
            {o.options.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Role">
          <Select name="role" defaultValue={sp.role ?? ""}>
            <option value="">All roles</option>
            {o.options.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Department">
          <Select name="department" defaultValue={sp.department ?? ""}>
            <option value="">All departments</option>
            {o.options.departments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Contract type">
          <Select name="type" defaultValue={sp.type ?? ""}>
            <option value="">All types</option>
            {o.options.contractTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <StatGrid cols={4}>
        <Stat label="Total headcount" value={<span className="flex items-center gap-2">{o.headcount} <Source kind="RECORDED" /></span>} sub={filtered ? "In this view" : "Whole company"} />
        <Stat
          label="Average monthly gross pay"
          value={<span className="flex items-center gap-2">{o.averageGross.kobo !== null ? money(o.averageGross.kobo) : "—"} <Source kind="CALCULATED" /></span>}
          sub={o.averageGross.kobo !== null ? o.payRun?.label : payText(o.averageGross, o.minimumGroup)}
        />
        <Stat label="Average length of service" value={<span className="flex items-center gap-2">{o.averageTenureYears === null ? "—" : `${o.averageTenureYears.toFixed(1)} yrs`} <Source kind="CALCULATED" /></span>} sub="From employment date" />
        <Stat
          label="People managers"
          value={<span className="flex items-center gap-2">{o.peopleManagers.percent.toFixed(1)}% <Source kind="CALCULATED" /></span>}
          sub={`${o.peopleManagers.count} of ${o.headcount} have direct reports`}
        />
      </StatGrid>

      {o.headcount === 0 ? (
        <Section title="Nobody matches">
          <Empty>No active employee matches these filters.</Empty>
        </Section>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Headcount by deployment site" description="Largest first. People not posted to a client site are counted as Not deployed." actions={<Source kind="RECORDED" />}>
              <BarsChart data={o.bySite.map((s) => ({ name: s.name, headcount: s.count }))} xKey="name" series={[{ key: "headcount", label: "Headcount" }]} horizontal money={false} height={Math.max(180, o.bySite.length * 34 + 40)} />
            </Section>
            <Section title="Headcount by role" description="Employee categories, largest first." actions={<Source kind="RECORDED" />}>
              <BarsChart data={o.byRole.map((r) => ({ name: r.name, headcount: r.count }))} xKey="name" series={[{ key: "headcount", label: "Headcount" }]} horizontal money={false} height={Math.max(180, o.byRole.length * 34 + 40)} />
            </Section>
            <Section title="Length of service" description="Whole years completed. The anniversary itself completes the year." actions={<Source kind="CALCULATED" />}>
              <BarsChart data={o.tenure.map((t) => ({ name: `${t.band} yrs`, people: t.count }))} xKey="name" series={[{ key: "people", label: "People" }]} money={false} height={240} />
            </Section>
            <Section
              title="Average monthly gross by role"
              description={hiddenRoles > 0 ? `${hiddenRoles} role${hiddenRoles === 1 ? " is" : "s are"} left out: fewer than ${o.minimumGroup} people with a pay figure.` : "Every role has at least the minimum number of people."}
              actions={<Source kind="CALCULATED" />}
            >
              {shownRoles.length ? (
                <BarsChart data={shownRoles.map((r) => ({ name: r.name, gross: (r.averageGross.kobo ?? 0) / 100 }))} xKey="name" series={[{ key: "gross", label: "Average monthly gross" }]} height={240} />
              ) : (
                <Empty>{o.averageGross.reason === "NO_PAYROLL" ? "No payroll run yet." : `No role has ${o.minimumGroup} or more people with a pay figure.`}</Empty>
              )}
            </Section>
          </div>

          <Section title="Contract type" description="The type on each person's active employment contract." actions={<Source kind="RECORDED" />}>
            <ul className="space-y-2">
              {o.contractTypes.map((c) => (
                <li key={c.type} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-3 text-sm">
                  <span>{c.label}</span>
                  <span className="h-3 rounded bg-secondary" role="img" aria-label={`${c.label}: ${c.share}% of people`}>
                    <span className="block h-3 rounded" style={{ width: `${c.share}%`, background: "var(--series-1)" }} />
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {c.count} ({c.share}%)
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Pay and length of service by deployment site" description={`Compared with the company average of the same view. A site with fewer than ${o.minimumGroup} people with a pay figure shows no average.`} flush actions={<Source kind="CALCULATED" />}>
            <Table>
              <THead>
                <TR>
                  <TH>Site</TH>
                  <TH className="text-right">Headcount</TH>
                  <TH className="text-right">Average monthly gross</TH>
                  <TH className="text-right">Against company</TH>
                  <TH className="text-right">Average service</TH>
                </TR>
              </THead>
              <TBody>
                {o.siteTable.map((s) => (
                  <TR key={s.key}>
                    <TD>{s.name}</TD>
                    <TD className="text-right tabular-nums">{s.count}</TD>
                    <TD className="text-right tabular-nums">{s.averageGross.kobo !== null ? money(s.averageGross.kobo) : <span className="text-muted-foreground">{payText(s.averageGross, o.minimumGroup)}</span>}</TD>
                    <TD className="text-right tabular-nums">{s.vsCompany === null ? "—" : `${s.vsCompany > 0 ? "+" : ""}${s.vsCompany}%`}</TD>
                    <TD className="text-right tabular-nums">{s.averageTenureYears === null ? "—" : `${s.averageTenureYears.toFixed(1)} yrs`}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </>
      )}
    </>
  );
}
