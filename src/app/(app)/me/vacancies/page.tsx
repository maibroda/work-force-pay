import { requirePage } from "@/lib/auth/session";
import { myApplications, openVacancies } from "@/server/services/recruitment-internal";
import { fmtDate } from "@/lib/dates";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { applyInternallyAction } from "@/app/actions/recruitment-internal";

export default async function VacanciesPage() {
  const ctx = await requirePage();
  const [vacancies, mine] = await Promise.all([openVacancies(ctx), myApplications(ctx)]);
  return (
    <>
      <PageHeader
        title="Vacancies"
        description="Jobs open to employees. You can apply to any of them. Your application goes to HR only: nobody else is told, including your manager."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <Empty>Your login isn&apos;t linked to an employee record yet, so you can&apos;t apply. Ask HR to link it.</Empty>
        </Section>
      ) : (
        <>
          <Section title="Open vacancies">
            {vacancies.length === 0 && <Empty>No vacancy is open to employees at the moment.</Empty>}
            {vacancies.map((v) => (
              <div key={v.requisitionId} className="mb-6 text-sm">
                <p className="text-base font-medium">{v.title}</p>
                <p className="text-xs text-muted-foreground">
                  {v.category}
                  {v.department ? ` · ${v.department}` : ""} · {v.employmentType.replace(/_/g, " ").toLowerCase()}
                  {v.targetStartDate ? ` · starts about ${fmtDate(v.targetStartDate)}` : ""} · apply by {fmtDate(v.applicationDeadline)}
                </p>
                <p className="mt-2 max-w-2xl whitespace-pre-line">{v.summary}</p>
                {v.applied ? (
                  <p className="mt-2 text-xs text-muted-foreground">You have applied for this vacancy.</p>
                ) : (
                  <FormPanel title="Apply for this vacancy">
                    <SmartForm
                      columns={1}
                      submitLabel="Send my application"
                      action={applyInternallyAction.bind(null, v.requisitionId)}
                      fields={[{ name: "note", label: "A short note for HR (optional)", type: "textarea", help: "Only HR will read it." }]}
                    />
                  </FormPanel>
                )}
              </div>
            ))}
          </Section>
          <Section title="My applications" flush>
            {mine.length === 0 ? (
              <Empty>You have not applied for any vacancy.</Empty>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Vacancy</TH>
                    <TH>Applied on</TH>
                    <TH>Where it is</TH>
                  </TR>
                </THead>
                <TBody>
                  {mine.map((a) => (
                    <TR key={a.candidateId}>
                      <TD>{a.title}</TD>
                      <TD>{fmtDate(a.appliedOn)}</TD>
                      <TD>
                        <StatusBadge status={a.stage} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
        </>
      )}
    </>
  );
}
