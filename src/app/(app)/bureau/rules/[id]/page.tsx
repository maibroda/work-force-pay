import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getRelease, RULE_KIND_LABELS } from "@/server/services/rule-library";
import { fmtDate, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { ActionButton } from "@/components/action-button";
import { KV, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { publishReleaseAction, verifyReleaseAction, withdrawReleaseAction } from "@/app/actions/rule-library";

export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("bureau.view");
  const { id } = await params;
  const r = await getRelease(ctx, id);
  if (!r) notFound();
  const { rel, master, intact, pendingClients } = r;
  const slotOf = ctx.role === "HR_ADMIN" ? "HR" : ctx.role === "FINANCE" ? "FINANCE" : null;
  const mine = rel.verifications.some((v) => v.slot === slotOf);
  const canVerify = can(ctx.role, "rules.verify") && slotOf && rel.status === "PROPOSED" && !mine && rel.proposedByUserId !== ctx.userId;
  const canManage = can(ctx.role, "rules.manage");

  return (
    <>
      <PageHeader
        title={rel.label}
        crumbs={[{ href: "/bureau/rules", label: "Statutory rule library" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {RULE_KIND_LABELS[rel.kind]} · effective {fmtDate(rel.effectiveFrom)} · <Badge>{rel.status.toLowerCase()}</Badge>
          </span>
        }
        actions={
          <>
            {canVerify && (
              <ActionButton action={verifyReleaseAction.bind(null, rel.id)} reason reasonPlaceholder="What did you check it against? (min 10 chars)" variant="success">
                Verify as {slotOf === "HR" ? "HR" : "Finance"}
              </ActionButton>
            )}
            {canManage && (rel.status === "VERIFIED" || (rel.status === "PUBLISHED" && pendingClients.length > 0)) && intact && (
              <ActionButton action={publishReleaseAction.bind(null, rel.id)} confirm={`Publish to ${pendingClients.length} client(s)?`}>
                Publish to {pendingClients.length} client(s)
              </ActionButton>
            )}
            {canManage && (rel.status === "PROPOSED" || rel.status === "VERIFIED") && (
              <ActionButton action={withdrawReleaseAction.bind(null, rel.id)} reason reasonPlaceholder="Why is it withdrawn? (min 10 chars)" variant="outline">
                Withdraw
              </ActionButton>
            )}
          </>
        }
      />

      {!intact && rel.status !== "WITHDRAWN" && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          The rule in the bureau&apos;s tables no longer matches what was proposed, so it cannot be verified or published. Withdraw this release and propose it again.
        </p>
      )}

      <Section title="What and why">
        <KV
          cols={2}
          items={[
            ["Source", rel.source],
            ["Proposed by", `${rel.proposedBy} on ${fmtDate(rel.createdAt)}`],
            ["Fingerprint", <code key="c" className="text-xs">{rel.checksum.slice(0, 16)}…</code>],
            ["Published", rel.publishedAt ? `${rel.publishedBy} on ${fmtDate(rel.publishedAt)}` : "Not yet"],
          ]}
        />
        <p className="mt-3 whitespace-pre-wrap rounded bg-muted px-3 py-2 text-sm">{rel.summary}</p>
        {rel.withdrawnReason && <p className="mt-2 text-sm text-red-700">Withdrawn by {rel.withdrawnBy}: {rel.withdrawnReason}</p>}
      </Section>

      {master && (
        <Section title="The rule itself" description="This is what is being verified. Check it against the source.">
          {master.kind === "TAX" && (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Band</TH>
                    <TH className="text-right">From (₦ a year)</TH>
                    <TH className="text-right">To</TH>
                    <TH className="text-right">Rate</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...master.row.bands].sort((a, b) => a.sortOrder - b.sortOrder).map((b) => (
                    <TR key={b.id}>
                      <TD>{b.sortOrder}</TD>
                      <TD className="text-right">{num(b.lowerBound).toLocaleString("en-NG")}</TD>
                      <TD className="text-right">{b.upperBound === null ? "and above" : num(b.upperBound).toLocaleString("en-NG")}</TD>
                      <TD className="text-right">{num(b.rate)}%</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <ul className="mt-3 list-disc pl-5 text-sm">
                {master.row.reliefs.map((x) => (
                  <li key={x.id}>
                    Relief: {x.name} ({x.type.replace(/_/g, " ").toLowerCase()}
                    {x.rate !== null ? `, ${num(x.rate)}%` : ""}
                    {x.amount !== null ? `, ₦${num(x.amount).toLocaleString("en-NG")}` : ""}
                    {x.cap !== null ? `, capped at ₦${num(x.cap).toLocaleString("en-NG")}` : ""}
                    {x.active ? "" : ", not in use"})
                  </li>
                ))}
                {master.row.exemptions.map((x) => (
                  <li key={x.id}>
                    Exemption: {x.description} (annual gross up to ₦{num(x.annualGrossCeiling).toLocaleString("en-NG")})
                  </li>
                ))}
              </ul>
              {master.row.legalBasis && <p className="mt-3 text-xs text-muted-foreground">Legal basis recorded on the rule: {master.row.legalBasis}</p>}
            </>
          )}
          {master.kind === "PENSION" && (
            <KV cols={3} items={[["Employee rate", `${num(master.row.employeeRate)}%`], ["Employer rate", `${num(master.row.employerRate)}%`], ["Pensionable pay", master.row.pensionableCodes.join(", ")]]} />
          )}
          {master.kind === "EMPLOYER_COST" && (
            <KV
              cols={4}
              items={[
                ["ITF", `${num(master.row.itfPct)}%`],
                ["NSITF", `${num(master.row.nsitfPct)}%`],
                ["NHF / medical", `${num(master.row.nhfMedicalPct)}%`],
                ["Insurance", `${num(master.row.insurancePct)}%`],
                ["Uniform & kits", `${num(master.row.uniformKitsPct)}%`],
                ["Recruitment & training", `${num(master.row.recruitmentTrainingPct)}%`],
                ["Leave reliever", `${num(master.row.leaveRelieverPct)}%`],
                ["Outsourcing leave allowance", `${num(master.row.outsourcingLeaveAllowancePct)}%`],
              ]}
            />
          )}
        </Section>
      )}

      <Section title="Verification" description="One from HR and one from Finance. The person who proposed the rule can't verify it.">
        <Table>
          <THead>
            <TR>
              <TH>Place</TH>
              <TH>Verified by</TH>
              <TH>Checked against</TH>
              <TH>When</TH>
            </TR>
          </THead>
          <TBody>
            {(["HR", "FINANCE"] as const).map((slot) => {
              const v = rel.verifications.find((x) => x.slot === slot);
              return (
                <TR key={slot}>
                  <TD>{slot === "HR" ? "HR" : "Finance"}</TD>
                  <TD>{v ? v.verifierName : <Badge tone="amber">Waiting</Badge>}</TD>
                  <TD className="whitespace-normal text-xs">{v?.note ?? "—"}</TD>
                  <TD className="text-xs">{v ? fmtDate(v.createdAt) : "—"}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Section>

      <Section title="Published to clients" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Result</TH>
              <TH>By</TH>
              <TH>When</TH>
            </TR>
          </THead>
          <TBody>
            {rel.publications.map((p) => (
              <TR key={p.id}>
                <TD>{p.client.name}</TD>
                <TD className="text-xs">{p.outcome === "ALREADY_HELD" ? "Already had this version" : "Published"}</TD>
                <TD className="text-xs">{p.publishedBy}</TD>
                <TD className="text-xs">{iso(p.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rel.publications.length && <p className="px-4 py-4 text-sm text-muted-foreground">Not published to any client yet.</p>}
        {pendingClients.length > 0 && rel.status !== "WITHDRAWN" && (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">Still to receive it: {pendingClients.map((c) => c.name).join(", ")}</p>
        )}
      </Section>
    </>
  );
}
