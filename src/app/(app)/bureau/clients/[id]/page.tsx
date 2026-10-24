import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { bureauStaff, getClient, PACKAGE_LABELS } from "@/server/services/bureau";
import { iso } from "@/lib/dates";
import { BusinessError } from "@/server/services/_base";
import { ActionButton } from "@/components/action-button";
import { KV, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { grantAccessAction, revokeAccessAction, switchOrganizationAction, updateEngagementAction } from "@/app/actions/bureau";
import { termsFields } from "../../terms-fields";
import { num } from "@/lib/money";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("bureau.view");
  const { id } = await params;
  const c = await getClient(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!c || !c.engagement) notFound();
  const e = c.engagement;
  const manage = can(ctx.role, "bureau.manage");
  const staff = manage ? await bureauStaff(ctx) : [];
  const granted = new Set(c.access.map((a) => a.userId));
  const eligible = staff.filter((s) => !granted.has(s.id) && can(s.role, "bureau.view") && !can(s.role, "bureau.manage"));

  return (
    <>
      <PageHeader
        title={c.org.name}
        crumbs={[{ href: "/bureau", label: "Clients" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{c.org.code}</span> <StatusBadge status={e.status} /> {PACKAGE_LABELS[e.package]} · {c.headcount} active employee(s)
          </span>
        }
        actions={
          <ActionButton action={switchOrganizationAction.bind(null, c.org.id)}>Work in this client</ActionButton>
        }
      />

      <Section title="Terms">
        <KV
          cols={3}
          items={[
            ["Rate per employee", `${num(e.perEmployeeRate).toLocaleString("en-NG")} / month`],
            ["Monthly minimum", num(e.monthlyMinimum).toLocaleString("en-NG")],
            ["Onboarding fee", num(e.onboardingFee).toLocaleString("en-NG")],
            ["Term", `${e.termMonths} months from ${iso(e.startDate)}`],
            ["Contact", [e.contactName, e.contactEmail, e.contactPhone].filter(Boolean).join(" · ") || "—"],
            ["Data-processing terms", e.dpaReference ? `${e.dpaReference}${e.dpaSignedAt ? `, signed ${iso(e.dpaSignedAt)}` : ""}` : "Not recorded"],
          ]}
        />
        {e.slaTerms && <p className="mt-3 whitespace-pre-wrap rounded bg-muted px-3 py-2 text-sm">{e.slaTerms}</p>}
      </Section>

      <Section title="Staff with access" description="Bureau managers can work in every client. Everyone else only in the clients they have been given." flush>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Given by</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.access.map((a) => (
              <TR key={a.id}>
                <TD>{a.user.name}</TD>
                <TD className="text-xs">{a.user.role.replace("_", " ")}</TD>
                <TD className="text-xs">{a.grantedBy}</TD>
                <TD>
                  {manage && (
                    <ActionButton action={revokeAccessAction.bind(null, c.org.id, a.userId)} confirm={`Remove ${a.user.name}'s access?`} variant="outline">
                      Remove
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!c.access.length && <p className="px-4 py-4 text-sm text-muted-foreground">No staff have been given access yet.</p>}
      </Section>

      {manage && eligible.length > 0 && (
        <Section title="Give a staff member access">
          <SmartForm
            columns={3}
            submitLabel="Give access"
            action={grantAccessAction.bind(null, c.org.id)}
            fields={[{ name: "userId", label: "Staff member", type: "select", required: true, options: eligible.map((s) => ({ value: s.id, label: `${s.name} (${s.role.replace("_", " ").toLowerCase()})` })) }]}
          />
        </Section>
      )}

      {manage && (
        <Section title="Edit terms and status">
          <SmartForm
            columns={3}
            submitLabel="Save changes"
            action={updateEngagementAction.bind(null, c.org.id)}
            fields={[
              {
                name: "status",
                label: "Status",
                type: "select",
                required: true,
                options: ["ONBOARDING", "ACTIVE", "PAUSED", "ENDED"].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() })),
                defaultValue: e.status,
              },
              ...termsFields({
                package: e.package,
                startDate: iso(e.startDate),
                termMonths: e.termMonths,
                perEmployeeRate: num(e.perEmployeeRate),
                monthlyMinimum: num(e.monthlyMinimum),
                onboardingFee: num(e.onboardingFee),
                addOns: e.addOns,
                contactName: e.contactName,
                contactEmail: e.contactEmail,
                contactPhone: e.contactPhone,
                slaTerms: e.slaTerms,
                dpaReference: e.dpaReference,
                dpaSignedAt: e.dpaSignedAt ? iso(e.dpaSignedAt) : "",
                notes: e.notes,
              }),
            ]}
          />
        </Section>
      )}
    </>
  );
}
