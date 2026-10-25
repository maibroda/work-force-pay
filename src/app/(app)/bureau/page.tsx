import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listClients, PACKAGE_LABELS, staffTwoFactorStatus } from "@/server/services/bureau";
import { launchProgress } from "@/server/services/launch-readiness";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { ActionButton } from "@/components/action-button";
import { Empty, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { bringForwardStaffTwoFactorAction, enableBureauAction, switchOrganizationAction } from "@/app/actions/bureau";

const STATE_BADGE = { ENROLLED: ["green", "On"], GRACE: ["amber", "Not set up yet"], BLOCKED: ["red", "Locked out until set up"], NOT_REQUIRED: ["gray", "—"] } as const;

export default async function BureauPage() {
  const ctx = await requirePage("bureau.view");
  const { bureau, clients } = await listClients(ctx);
  const manage = can(ctx.role, "bureau.manage");
  const tf = bureau.isBureau && !ctx.homeOrgId ? await staffTwoFactorStatus(ctx) : null;
  const launch = bureau.isBureau && !ctx.homeOrgId ? await launchProgress(ctx) : null;

  if (!bureau.isBureau)
    return (
      <>
        <PageHeader title="Clients" description="This organization is not set up as a payroll bureau." />
        {manage && !bureau.bureauOrganizationId && (
          <Section title="Set up as a payroll bureau" description="A bureau serves client organizations, each with its own employees, pay rules and payroll. Its own statutory rule tables become the starting point for every client it onboards.">
            <ActionButton action={enableBureauAction} confirm={`Make ${bureau.name} a payroll bureau?`}>
              Make this a payroll bureau
            </ActionButton>
          </Section>
        )}
      </>
    );

  return (
    <>
      <PageHeader
        title={`${bureau.name} — clients`}
        description={manage ? "Every client of the bureau." : "The clients you have been given access to."}
        actions={
          manage && (
            <Link className={buttonVariants()} href="/bureau/clients/new">
              + Onboard a client
            </Link>
          )
        }
      />
      {launch && !launch.ready && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          Launch checklist: {launch.done} of {launch.total} done.{" "}
          <Link className="text-primary underline" href="/bureau/readiness">
            See what is left
          </Link>
        </p>
      )}
      <Section title={`${clients.length} client(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Package</TH>
              <TH>Status</TH>
              <TH className="text-right">Employees</TH>
              <TH className="text-right">Rate / month</TH>
              <TH>Latest payroll</TH>
              <TH>Started</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {clients.map(({ org, engagement, headcount, latestRun }) => (
              <TR key={org.id}>
                <TD>
                  <Link className="text-primary underline" href={`/bureau/clients/${org.id}`}>
                    {org.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{org.code}</span>
                </TD>
                <TD className="text-xs">{engagement ? PACKAGE_LABELS[engagement.package] : "—"}</TD>
                <TD>{engagement ? <StatusBadge status={engagement.status} /> : "—"}</TD>
                <TD className="text-right">{headcount}</TD>
                <TD className="text-right text-xs">
                  {engagement ? `${naira(engagement.perEmployeeRate)} each` : "—"}
                  {engagement && num(engagement.monthlyMinimum) > 0 ? `, min ${naira(engagement.monthlyMinimum)}` : ""}
                </TD>
                <TD className="text-xs">{latestRun ? `${latestRun.period} · ${latestRun.status.replace("_", " ")}` : "No payroll yet"}</TD>
                <TD className="text-xs">{engagement ? fmtDate(engagement.startDate) : "—"}</TD>
                <TD>
                  <ActionButton action={switchOrganizationAction.bind(null, org.id)} variant="outline">
                    Work in this client
                  </ActionButton>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!clients.length && <Empty>{manage ? "No clients yet. Onboard the first one above." : "You have not been given access to any client yet. Ask a bureau manager."}</Empty>}
      </Section>
      {tf?.from && (
        <Section
          title="Staff two-factor sign-in"
          description={`Compulsory for everyone who works for ${bureau.name}, in any role and in every client${tf.inForce ? " — in force since" : ", from"} ${iso(tf.from)}. ${tf.missing} of ${tf.rows.length} active user(s) haven't set it up${tf.missing && tf.inForce ? " and can reach nothing but My security" : ""}. The day can be brought forward but never put back.`}
        >
          {manage && (
            <SmartForm
              columns={3}
              submitLabel="Bring the day forward"
              resetOnSuccess={false}
              action={bringForwardStaffTwoFactorAction}
              fields={[{ name: "from", label: "Compulsory from", type: "date", defaultValue: iso(tf.from), required: true }]}
            />
          )}
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Two-factor</TH>
              </TR>
            </THead>
            <TBody>
              {tf.rows.map((u) => (
                <TR key={u.id}>
                  <TD>{u.name}</TD>
                  <TD className="text-xs">{u.email}</TD>
                  <TD className="text-xs">{u.role.replace(/_/g, " ")}</TD>
                  <TD>
                    <Badge tone={STATE_BADGE[u.state][0]}>{u.totpEnabled ? "On" : STATE_BADGE[u.state][1]}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
