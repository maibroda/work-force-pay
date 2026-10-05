import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getContract } from "@/server/services/contracts";
import { enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FormPanel, KV, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { decideProbationAction, renewContractAction } from "@/app/actions/hr-lifecycle";

const TYPES = ["PERMANENT", "FIXED_TERM", "PROBATION", "CASUAL", "CONSULTANT", "INTERNSHIP"];

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const c = await getContract(ctx, id);
  if (!c) notFound();
  const manage = can(ctx.role, "hr.manage");
  const approve = can(ctx.role, "hr.approve");
  const active = c.status === "ACTIVE";
  const reviewing = active && (c.probationOutcome === "PENDING" || c.probationOutcome === "EXTENDED");
  return (
    <>
      <PageHeader
        title={`${c.contractNumber} — ${c.jobTitle}`}
        crumbs={[{ href: "/hr/contracts", label: "Contracts" }]}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={c.status} /> {c.type.replace(/_/g, " ").toLowerCase()} ·{" "}
            <Link className="text-primary underline" href={`/employees/${c.employeeId}`}>
              {c.employee.employeeNumber} — {fullName(c.employee)}
            </Link>
          </span>
        }
      />
      <Section title="Terms">
        <KV
          cols={4}
          items={[
            ["Start date", fmtDate(c.startDate)],
            ["End date", c.endDate ? fmtDate(c.endDate) : "Open-ended"],
            ["Notice period", `${c.noticePeriodDays} days`],
            ["Signed", c.signedDate ? fmtDate(c.signedDate) : "Not recorded"],
            ["Probation", c.probationMonths ? `${c.probationMonths} month(s), ends ${fmtDate(c.probationEndDate)}` : "None"],
            ["Probation outcome", c.probationOutcome ? <StatusBadge key="p" status={c.probationOutcome} /> : "—"],
            ["Extensions", c.probationExtensions],
            ["Document", c.documentReference],
            ["Previous contract", c.previousContract ? <Link key="pc" className="text-primary underline" href={`/hr/contracts/${c.previousContract.id}`}>{c.previousContract.contractNumber}</Link> : "—"],
            ["Renewed as", c.renewals.length ? c.renewals.map((r) => <Link key={r.id} className="mr-2 text-primary underline" href={`/hr/contracts/${r.id}`}>{r.contractNumber}</Link>) : "—"],
            ["Terminated", c.terminatedAt ? `${fmtDate(c.terminatedAt)} — ${c.terminationReason ?? ""}` : "—"],
            ["Created by", `${c.createdBy} · ${fmtDate(c.createdAt)}`],
            ["Notes", <span key="n" className="whitespace-pre-line">{c.notes ?? "—"}</span>],
          ]}
        />
      </Section>

      {approve && reviewing && (
        <div className="grid gap-5 lg:grid-cols-3">
          <FormPanel title="Confirm probation" open>
            <SmartForm
              columns={1}
              submitLabel="Confirm"
              action={decideProbationAction.bind(null, c.id)}
              fields={[
                { name: "decision", label: "", type: "hidden", defaultValue: "CONFIRMED" },
                ...(c.type === "PROBATION"
                  ? [
                      { name: "effectiveDate", label: "Permanent from", type: "date" as const, help: "Blank = the day after probation ends." },
                      { name: "noticePeriodDays", label: "Notice period after confirmation (days)", type: "number" as const, min: 0 },
                    ]
                  : []),
                { name: "note", label: "Note", type: "textarea" },
              ]}
            />
          </FormPanel>
          <FormPanel title="Extend probation">
            <SmartForm
              columns={1}
              submitLabel="Extend"
              action={decideProbationAction.bind(null, c.id)}
              fields={[
                { name: "decision", label: "", type: "hidden", defaultValue: "EXTENDED" },
                { name: "extensionMonths", label: "Extend by (months)", type: "number", required: true, min: 1, max: 12 },
                { name: "note", label: "Reason", type: "textarea", required: true },
              ]}
            />
          </FormPanel>
          <FormPanel title="Fail probation">
            <SmartForm
              columns={1}
              submitLabel="Mark as failed"
              action={decideProbationAction.bind(null, c.id)}
              fields={[
                { name: "decision", label: "", type: "hidden", defaultValue: "FAILED" },
                { name: "note", label: "Reason", type: "textarea", required: true },
              ]}
            />
          </FormPanel>
        </div>
      )}

      {manage && active && (
        <FormPanel title="Renew, extend or convert this contract">
          <p className="mb-3 text-xs text-muted-foreground">
            Creates the next contract in the chain and supersedes this one. Leave the start date blank to start the day after this contract ends.
          </p>
          <SmartForm
            columns={3}
            submitLabel="Renew"
            action={renewContractAction.bind(null, c.id)}
            fields={[
              { name: "type", label: "Type", type: "select", options: enumOptions(TYPES), defaultValue: c.type === "PROBATION" ? "PERMANENT" : c.type },
              { name: "jobTitle", label: "Job title", defaultValue: c.jobTitle },
              { name: "startDate", label: "Start date", type: "date" },
              { name: "endDate", label: "End date", type: "date", help: "Blank for permanent." },
              { name: "noticePeriodDays", label: "Notice period (days)", type: "number", min: 0, defaultValue: c.noticePeriodDays },
              { name: "signedDate", label: "Signed on", type: "date" },
              { name: "documentReference", label: "Document reference", span: 2 },
              { name: "notes", label: "Notes", type: "textarea", span: 3 },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
