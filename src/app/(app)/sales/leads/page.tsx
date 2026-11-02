import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { listLeads } from "@/server/services/sales/records";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createLeadAction } from "@/app/actions/sales";

const SOURCES = ["REFERRAL", "WALK_IN", "PHONE", "WEBSITE", "WHATSAPP", "TENDER", "EVENT", "EXISTING_CLIENT", "OTHER"];
const SERVICES = ["GUARDING", "CLEANING", "FACILITY", "STAFFING", "OTHER"];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export default async function SalesLeadsPage() {
  const ctx = await requirePage("sales.view");
  let leads: Awaited<ReturnType<typeof listLeads>> = [];
  let why = "";
  try {
    leads = await listLeads(ctx);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    why = e.message;
  }
  const canManage = can(ctx.role, "sales.manage");
  return (
    <>
      <PageHeader title="Leads" description="Enquiries not yet known to be real. A sales person sees their own; a manager sees everyone's." />
      {why && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {why}{" "}
          {can(ctx.role, "sales.configure") && (
            <Link className="underline" href="/sales/settings">
              Open Sales settings
            </Link>
          )}
        </p>
      )}
      {!why && (
        <Section title={`${leads.length} lead(s)`} flush>
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Company</TH>
                <TH>Contact</TH>
                <TH>Service</TH>
                <TH>Source</TH>
                <TH>Owner</TH>
                <TH>Status</TH>
                <TH>Added</TH>
              </TR>
            </THead>
            <TBody>
              {leads.map((l) => (
                <TR key={l.id}>
                  <TD className="font-mono text-xs">
                    <Link className="underline" href={`/sales/leads/${l.id}`}>
                      {l.number}
                    </Link>
                  </TD>
                  <TD>{l.companyName}</TD>
                  <TD className="text-xs">{[l.contactName, l.phoneE164].filter(Boolean).join(" · ") || "—"}</TD>
                  <TD className="text-xs">{label(l.serviceInterest)}</TD>
                  <TD className="text-xs">{label(l.source)}</TD>
                  <TD className="text-xs">{l.ownerName}</TD>
                  <TD>
                    <Badge tone={l.status === "QUALIFIED" ? "green" : l.status === "UNQUALIFIED" ? "red" : undefined}>{label(l.status)}</Badge>
                  </TD>
                  <TD className="text-xs">{fmtDate(l.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!leads.length && <p className="px-4 py-4 text-sm text-muted-foreground">No leads yet.</p>}
        </Section>
      )}
      {!why && canManage && (
        <Section title="Add a lead" description="Phone numbers are stored in one international form (+234...), so 0803 123 4567 and +234 803 123 4567 are the same number.">
          <SmartForm
            columns={3}
            submitLabel="Add lead"
            resetOnSuccess
            action={createLeadAction}
            fields={[
              { name: "companyName", label: "Company", required: true },
              { name: "contactName", label: "Contact person" },
              { name: "jobTitle", label: "Job title" },
              { name: "phone", label: "Phone" },
              { name: "email", label: "Email", type: "email" },
              { name: "industry", label: "Industry" },
              { name: "state", label: "State" },
              { name: "source", label: "Source", type: "select", defaultValue: "OTHER", options: SOURCES.map((s) => ({ value: s, label: label(s) })) },
              { name: "serviceInterest", label: "Service wanted", type: "select", defaultValue: "GUARDING", options: SERVICES.map((s) => ({ value: s, label: label(s) })) },
              { name: "estimatedGuards", label: "Estimated guards", type: "number" },
              { name: "sourceDetail", label: "Source detail (who referred, which event)", span: 2 },
              { name: "createAnyway", label: "Create anyway if it looks like a duplicate", type: "checkbox" },
            ]}
          />
        </Section>
      )}
    </>
  );
}
