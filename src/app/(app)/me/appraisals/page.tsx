import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { myAppraisals, myQueue } from "@/server/services/appraisals";
import { KIND_LABELS } from "@/lib/appraisal";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Empty } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function MyAppraisalsPage() {
  const ctx = await requirePage();
  const [{ toReview, toApprove }, mine] = await Promise.all([myQueue(ctx), myAppraisals(ctx)]);
  const today = new Date();
  return (
    <>
      <PageHeader title="My appraisals" description="Your own reviews, the ones you've been asked to write, and any waiting for your sign-off." />

      {toReview.length > 0 && (
        <Section title="To review" description="Staff you've been asked to rate." flush>
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Cycle</TH>
                <TH>Due</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {toReview.map((a) => (
                <TR key={a.id}>
                  <TD>
                    {a.employee.employeeNumber} {fullName(a.employee)} {a.returnNote && <Badge tone="amber">returned</Badge>}
                  </TD>
                  <TD className="text-xs">{a.cycle.name}</TD>
                  <TD className="text-xs">
                    {fmtDate(a.cycle.dueDate)} {a.cycle.dueDate < today && <Badge tone="red">overdue</Badge>}
                  </TD>
                  <TD className="text-right">
                    <Link className="text-primary underline" href={`/hr/appraisals/${a.id}`}>
                      Open
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {toApprove.length > 0 && (
        <Section title="Waiting for your sign-off" flush>
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Cycle</TH>
                <TH>Reviewer</TH>
                <TH>Score</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {toApprove.map((a) => (
                <TR key={a.id}>
                  <TD>
                    {a.employee.employeeNumber} {fullName(a.employee)}
                  </TD>
                  <TD className="text-xs">{a.cycle.name}</TD>
                  <TD className="text-xs">{a.reviewerName}</TD>
                  <TD className="text-xs">{a.overallScore != null ? `${num(a.overallScore).toFixed(2)} — ${a.overallBand}` : "—"}</TD>
                  <TD className="text-right">
                    <Link className="text-primary underline" href={`/hr/appraisals/${a.id}`}>
                      Open
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      <Section title="My reviews" flush>
        <Table>
          <THead>
            <TR>
              <TH>Cycle</TH>
              <TH>Type</TH>
              <TH>Period</TH>
              <TH>Status</TH>
              <TH>Result</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {mine.map((a) => (
              <TR key={a.id}>
                <TD>{a.cycle.name}</TD>
                <TD className="text-xs">{KIND_LABELS[a.cycle.kind]}</TD>
                <TD className="text-xs">
                  {fmtDate(a.cycle.periodStart)} – {fmtDate(a.cycle.periodEnd)}
                </TD>
                <TD>
                  <StatusBadge status={a.status} />
                </TD>
                <TD className="text-xs">{a.overallScore != null ? `${num(a.overallScore).toFixed(2)} — ${a.overallBand}` : "—"}</TD>
                <TD className="text-right">
                  <Link className="text-primary underline" href={`/hr/appraisals/${a.id}`}>
                    {a.status === "APPROVED" ? "Read & respond" : a.status === "DRAFT" ? "Self-assess" : "Open"}
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!mine.length && <Empty>{ctx.employeeId ? "You haven't been included in an appraisal yet." : "Your login isn't linked to an employee record, so there are no appraisals of you."}</Empty>}
      </Section>
    </>
  );
}
