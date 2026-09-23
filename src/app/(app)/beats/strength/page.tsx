import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listBeats } from "@/server/services/clients";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SmartForm } from "@/components/smart-form";
import { updateStrengthAction } from "@/app/actions/clients";

export default async function StrengthPage() {
  const ctx = await requirePage("client.view");
  const beats = await listBeats(ctx);
  const manage = can(ctx.role, "client.manage");
  const approved = beats.reduce((a, b) => a + b.approvedStrength, 0);
  const actual = beats.reduce((a, b) => a + b.actualStrength, 0);
  return (
    <>
      <PageHeader title="Approved strength" description="Approved manpower per beat vs actual deployment." />
      <StatGrid cols={4}>
        <Stat label="Approved strength" value={approved} />
        <Stat label="Actual strength" value={actual} />
        <Stat label="Vacancies" value={beats.reduce((a, b) => a + b.vacancies, 0)} tone="amber" />
        <Stat label="Over-deployment" value={beats.reduce((a, b) => a + b.overdeployed, 0)} tone="red" />
      </StatGrid>
      <Section title="Beats" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Beat</TH>
              <TH className="text-right">Approved</TH>
              <TH className="text-right">Actual</TH>
              <TH>Status</TH>
              {manage && <TH>Change approved strength</TH>}
            </TR>
          </THead>
          <TBody>
            {beats.map((b) => (
              <TR key={b.id}>
                <TD>{b.client.name}</TD>
                <TD>{b.name}</TD>
                <TD className="text-right">{b.approvedStrength}</TD>
                <TD className="text-right">{b.actualStrength}</TD>
                <TD>
                  <StatusBadge status={b.status} />
                </TD>
                {manage && (
                  <TD className="min-w-80">
                    <SmartForm
                      columns={2}
                      submitLabel="Update"
                      resetOnSuccess={false}
                      fields={[
                        {
                          name: "approvedStrength",
                          label: "Strength",
                          type: "number",
                          required: true,
                          min: 0,
                          defaultValue: b.approvedStrength,
                        },
                        { name: "reason", label: "Reason" },
                      ]}
                      action={updateStrengthAction.bind(null, b.id)}
                      className="[&_button]:h-8"
                    />
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
