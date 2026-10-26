import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listOutreach, outreachToday } from "@/server/services/crm";
import { CHANNEL_LABELS, DAILY_CONTACT_TARGET, isContact, OUTCOME_LABELS } from "@/lib/crm";
import { fmtDate, iso } from "@/lib/dates";
import { Empty, FormPanel, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { logOutreachAction } from "@/app/actions/crm";
import { crmGate } from "../_gate";
import { outreachFields } from "../_fields";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("crm.view");
  const gate = await crmGate(ctx, "Outreach");
  if (gate) return gate;
  const sp = await searchParams;
  const today = iso(new Date());
  const from = iso(new Date(Date.now() - 6 * 86_400_000));
  const mine = sp.who === "me";
  const [t, rows] = await Promise.all([outreachToday(ctx), listOutreach(ctx, { from, to: today, userId: mine ? ctx.userId : undefined })]);
  const manage = can(ctx.role, "crm.manage");
  return (
    <>
      <PageHeader
        title="Outreach"
        crumbs={[{ href: "/crm", label: "Sales pipeline" }]}
        description={`The target is ${DAILY_CONTACT_TARGET} qualified contacts a working day. A contact counts when you reached a decision-maker: you spoke to them, booked a meeting, or qualified them. Entries can't be changed afterwards, and can be dated up to 14 days back.`}
      />
      <StatGrid cols={3}>
        <Stat label="Your contacts today" value={`${t.mine} of ${t.target}`} tone={t.mine >= t.target ? "green" : "amber"} />
        <Stat label="Team contacts today" value={t.team} />
        <Stat label="Attempts today (team)" value={t.attempts} />
      </StatGrid>
      {manage && (
        <FormPanel title="Log an outreach">
          <SmartForm columns={3} submitLabel="Log it" resetOnSuccess action={logOutreachAction} fields={outreachFields({ withCompany: true, today })} />
        </FormPanel>
      )}
      <div className="no-print mb-3 flex gap-2 text-sm">
        <Link href="/crm/outreach" className={!mine ? "rounded bg-primary px-3 py-1 text-primary-foreground" : "rounded border px-3 py-1 hover:bg-accent"}>
          Everyone
        </Link>
        <Link href="/crm/outreach?who=me" className={mine ? "rounded bg-primary px-3 py-1 text-primary-foreground" : "rounded border px-3 py-1 hover:bg-accent"}>
          Just me
        </Link>
      </div>
      <Section title="The last 7 days" flush>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Company</TH>
              <TH>How</TH>
              <TH>What came of it</TH>
              <TH>By</TH>
              <TH>Note</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((a) => (
              <TR key={a.id}>
                <TD className="text-xs">{fmtDate(a.date)}</TD>
                <TD className="text-xs">
                  {a.leadId ? (
                    <Link className="text-primary underline" href={`/crm/leads/${a.leadId}`}>
                      {a.company}
                    </Link>
                  ) : (
                    a.company
                  )}
                  {a.contactName && <span className="ml-1 text-muted-foreground">· {a.contactName}</span>}
                </TD>
                <TD className="text-xs">{CHANNEL_LABELS[a.channel]}</TD>
                <TD>
                  <Badge tone={isContact(a.outcome) ? "green" : "gray"}>{OUTCOME_LABELS[a.outcome]}</Badge>
                </TD>
                <TD className="text-xs">{a.byName}</TD>
                <TD className="whitespace-normal text-xs">{a.note ?? ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>Nothing logged in the last 7 days.</Empty>}
      </Section>
    </>
  );
}
