import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { activationSummary } from "@/server/services/clients";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function ActivationPage() {
  const ctx = await requirePage("operations.view");
  const a = await activationSummary(ctx);
  const beatTable = (list: typeof a.beats) =>
    list.length ? (
      <Table>
        <THead>
          <TR>
            <TH>Client</TH>
            <TH>Beat</TH>
            <TH className="text-right">Approved</TH>
            <TH className="text-right">Actual</TH>
            <TH>Status</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {list.map((b) => (
            <TR key={b.id}>
              <TD>{b.client.name}</TD>
              <TD>{b.name}</TD>
              <TD className="text-right">{b.approvedStrength}</TD>
              <TD className="text-right">{b.actualStrength}</TD>
              <TD>
                <StatusBadge status={b.status} />
              </TD>
              <TD>
                <Link
                  className="text-xs text-primary underline"
                  href={`/operations/deployments?beatId=${b.id}`}
                >
                  Map staff
                </Link>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    ) : (
      <Empty>None 🎉</Empty>
    );
  return (
    <>
      <PageHeader
        title="Activation dashboard"
        description="New beats are activated every month. This view stops operational mapping errors from entering payroll."
      />
      <StatGrid cols={4}>
        <Stat
          label="New activations this month"
          value={a.newActivations}
          sub={`${a.newClients} clients · ${a.newContracts} contracts · ${a.newBeats} beats`}
        />
        <Stat label="Unmapped beats" value={a.unmapped.length} tone={a.unmapped.length ? "red" : "green"} />
        <Stat
          label="Unassigned employees"
          value={a.unassigned.length}
          tone={a.unassigned.length ? "amber" : "green"}
        />
        <Stat
          label="Beats below / above strength"
          value={`${a.below.length} / ${a.above.length}`}
          tone={a.above.length ? "red" : "amber"}
        />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Unmapped beats" description="No employees deployed" flush>
          {beatTable(a.unmapped)}
        </Section>
        <Section title="Locations above approved strength" flush>
          {beatTable(a.above)}
        </Section>
        <Section title="Locations below approved strength" flush>
          {beatTable(a.below)}
        </Section>
        <Section title="Unassigned active employees" flush>
          {a.unassigned.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Emp. No.</TH>
                  <TH>Name</TH>
                  <TH>Category</TH>
                </TR>
              </THead>
              <TBody>
                {a.unassigned.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <Link
                        className="text-primary hover:underline"
                        href={`/employees/${e.id}?tab=assignments`}
                      >
                        {e.employeeNumber}
                      </Link>
                    </TD>
                    <TD>{fullName(e)}</TD>
                    <TD>{e.category.name}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty>None</Empty>
          )}
        </Section>
      </div>
    </>
  );
}
