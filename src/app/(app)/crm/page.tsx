import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listLeads, outreachToday, salesDashboard } from "@/server/services/crm";
import { presetRange, OPEN_STAGES, STAGE_LABELS } from "@/lib/crm";
import { fmtDate, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { crmGate } from "./_gate";

const RANGES = [
  ["week", "This week"],
  ["month", "This month"],
  ["30d", "Last 30 days"],
] as const;

export default async function CrmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("crm.view");
  const gate = await crmGate(ctx, "Sales pipeline");
  if (gate) return gate;
  const sp = await searchParams;
  const preset = RANGES.some(([k]) => k === sp.range) ? (sp.range as "week" | "month" | "30d") : "week";
  const today = iso(new Date());
  const range = presetRange(preset, today);
  const [d, t, open] = await Promise.all([salesDashboard(ctx, range), outreachToday(ctx), listLeads(ctx, { open: true })]);
  const manage = can(ctx.role, "crm.manage");
  return (
    <>
      <PageHeader
        title="Sales pipeline"
        description={`${fmtDate(range.from)} to ${fmtDate(range.to)}. What the log says happened, not a forecast: MRR is the monthly fee expected when a lead was won, and the real figure comes from billing.`}
        actions={
          manage && (
            <Link className={buttonVariants()} href="/crm/leads">
              + Add a lead
            </Link>
          )
        }
      />
      <div className="no-print mb-4 flex gap-2 text-sm">
        {RANGES.map(([k, label]) => (
          <Link key={k} href={`/crm?range=${k}`} className={k === preset ? "rounded bg-primary px-3 py-1 text-primary-foreground" : "rounded border px-3 py-1 hover:bg-accent"}>
            {label}
          </Link>
        ))}
      </div>
      <StatGrid cols={4}>
        <Stat label="Contacts made today (you)" value={`${t.mine} of ${t.target}`} sub={`Team: ${t.team}`} tone={t.mine >= t.target ? "green" : "amber"} />
        <Stat label="Qualified contacts" value={d.contacts} sub={`${d.attempts} attempts · ${d.contactsPerWorkingDay} a working day · ${d.daysOnTarget} of ${d.workingDays} days on target`} />
        <Stat label="Discovery meetings" value={d.discoveryMeetings} />
        <Stat label="Proposals" value={d.proposals} />
        <Stat label="Won" value={d.won} sub={`${d.lost} lost`} tone={d.won ? "green" : undefined} />
        <Stat label="Conversion" value={d.conversion === null ? "—" : `${d.conversion}%`} sub="won of won and lost" />
        <Stat label="MRR won" value={naira(d.mrrWon)} sub={`${naira(d.mrrTotal)} in all`} />
        <Stat label="Open pipeline (MRR)" value={naira(d.pipelineMrr)} />
      </StatGrid>

      {OPEN_STAGES.map((s) => {
        const here = open.filter((l) => l.stage === s);
        return (
          <Section key={s} title={`${STAGE_LABELS[s]} (${here.length})`} flush>
            {here.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Lead</TH>
                    <TH>Company</TH>
                    <TH className="text-right">Staff</TH>
                    <TH className="text-right">Expected MRR</TH>
                    <TH>Owner</TH>
                    <TH>Next step</TH>
                    <TH>In stage since</TH>
                  </TR>
                </THead>
                <TBody>
                  {here.map((l) => (
                    <TR key={l.id}>
                      <TD className="font-mono text-xs">{l.number}</TD>
                      <TD>
                        <Link className="text-primary underline" href={`/crm/leads/${l.id}`}>
                          {l.company}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">{l.contactName}</span>
                      </TD>
                      <TD className="text-right">{l.headcount ?? "—"}</TD>
                      <TD className="text-right text-xs">{Number(l.expectedMrr) ? naira(l.expectedMrr) : "—"}</TD>
                      <TD className="text-xs">{l.ownerName}</TD>
                      <TD className="whitespace-normal text-xs">
                        {l.nextStep ?? "—"}
                        {l.nextStepOn && <span className={iso(l.nextStepOn) < today ? " text-red-700" : " text-muted-foreground"}> · {fmtDate(l.nextStepOn)}</span>}
                      </TD>
                      <TD className="text-xs">{fmtDate(l.stageChangedAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>No leads at this stage.</Empty>
            )}
          </Section>
        );
      })}

      <Section title="By person" description="Outreach in this period." flush>
        <Table>
          <THead>
            <TR>
              <TH>Person</TH>
              <TH className="text-right">Attempts</TH>
              <TH className="text-right">Qualified contacts</TH>
            </TR>
          </THead>
          <TBody>
            {d.byPerson.map((p) => (
              <TR key={p.name}>
                <TD>{p.name}</TD>
                <TD className="text-right">{p.attempts}</TD>
                <TD className="text-right">{p.contacts}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!d.byPerson.length && <Empty>No outreach logged in this period.</Empty>}
      </Section>
    </>
  );
}
