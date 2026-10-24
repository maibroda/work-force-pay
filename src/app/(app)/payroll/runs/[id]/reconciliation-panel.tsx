import { can } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/auth/context";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import type { ReconciliationView } from "@/server/services/payroll-controls";
import { ActionButton } from "@/components/action-button";
import { Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { signOffReconciliationAction } from "@/app/actions/payroll";

const signed = (n: number) => (n === 0 ? "—" : (n > 0 ? "+" : "−") + naira(Math.abs(n)));

/** The walk from the previous payroll to this one, and its sign-off. */
export function ReconciliationPanel({ ctx, view }: { ctx: Ctx; view: ReconciliationView }) {
  const { run, bridge, prior } = view;
  const canSign = can(ctx.role, "payroll.run") && run.status === "CALCULATED" && run.type === "REGULAR";
  return (
    <Section
      title="Reconciliation to the previous payroll"
      description={
        prior
          ? `Walks ${prior.periodName} (run #${prior.runNumber}) to this payroll: who joined, who left, and what changed for everyone else.`
          : "There is no earlier approved payroll to compare with, so there is nothing to reconcile to."
      }
      actions={
        run.reconciledAt ? (
          <Badge tone="green">Signed off</Badge>
        ) : view.reconciliationRequired ? (
          <Badge tone="amber">Sign-off required before submission</Badge>
        ) : (
          <Badge>Sign-off optional</Badge>
        )
      }
    >
      {bridge.hasPrior && (
        <Table>
          <THead>
            <TR>
              <TH />
              <TH className="text-right">Headcount</TH>
              <TH className="text-right">Gross</TH>
              <TH className="text-right">Net pay</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD>Previous payroll</TD>
              <TD className="text-right">{bridge.priorHeadcount}</TD>
              <TD className="text-right">{naira(bridge.gross.prior)}</TD>
              <TD className="text-right">{naira(bridge.net.prior)}</TD>
            </TR>
            <TR>
              <TD>Joiners</TD>
              <TD className="text-right">{bridge.joiners.length ? `+${bridge.joiners.length}` : "—"}</TD>
              <TD className="text-right">{signed(bridge.gross.joiners)}</TD>
              <TD className="text-right">{signed(bridge.net.joiners)}</TD>
            </TR>
            <TR>
              <TD>Leavers</TD>
              <TD className="text-right">{bridge.leavers.length ? `−${bridge.leavers.length}` : "—"}</TD>
              <TD className="text-right">{signed(bridge.gross.leavers)}</TD>
              <TD className="text-right">{signed(bridge.net.leavers)}</TD>
            </TR>
            <TR className={bridge.otherAdded.length || bridge.otherRemoved.length ? "bg-amber-50" : ""}>
              <TD>Not a joiner or leaver (appeared / dropped out)</TD>
              <TD className="text-right">
                {bridge.otherAdded.length || bridge.otherRemoved.length ? `+${bridge.otherAdded.length} / −${bridge.otherRemoved.length}` : "—"}
              </TD>
              <TD className="text-right">{signed(bridge.gross.otherAdded + bridge.gross.otherRemoved)}</TD>
              <TD className="text-right">{signed(bridge.net.otherAdded + bridge.net.otherRemoved)}</TD>
            </TR>
            <TR>
              <TD>Change for continuing staff</TD>
              <TD className="text-right">—</TD>
              <TD className="text-right">{signed(bridge.gross.continuing)}</TD>
              <TD className="text-right">{signed(bridge.net.continuing)}</TD>
            </TR>
            <TR className="font-semibold">
              <TD>This payroll</TD>
              <TD className="text-right">{bridge.currentHeadcount}</TD>
              <TD className="text-right">{naira(bridge.gross.current)}</TD>
              <TD className="text-right">{naira(bridge.net.current)}</TD>
            </TR>
          </TBody>
        </Table>
      )}
      {(bridge.otherAdded.length > 0 || bridge.otherRemoved.length > 0) && (
        <div className="mt-3 text-xs">
          <p className="font-medium text-amber-800">These need a word in the sign-off note:</p>
          <ul className="list-disc pl-5">
            {bridge.otherAdded.map((p) => (
              <li key={p.id}>{p.label} is paid now and was not in the previous payroll.</li>
            ))}
            {bridge.otherRemoved.map((p) => (
              <li key={p.id}>{p.label} was paid last time and is not in this payroll.</li>
            ))}
          </ul>
        </div>
      )}
      {!bridge.balanced && <p className="mt-3 text-sm font-medium text-red-700">The bridge does not add up. Recalculate the payroll.</p>}
      {run.reconciledAt ? (
        <p className="mt-3 text-sm">
          Signed off by <b>{run.reconciledBy}</b> on {fmtDate(run.reconciledAt)}.
          {run.reconciliationNote ? ` Note: ${run.reconciliationNote}` : ""}
        </p>
      ) : (
        canSign && (
          <div className="mt-3">
            <ActionButton
              action={signOffReconciliationAction.bind(null, run.id)}
              reason
              reasonPlaceholder={bridge.hasPrior ? "Note for the record (say why, if anyone appears or drops out)" : "Say why there is nothing to reconcile to, e.g. first payroll"}
            >
              Sign off reconciliation
            </ActionButton>
          </div>
        )
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Limits for variance findings: headcount {view.policy.headcountPct}%, total net pay {view.policy.totalPct}%, one person&apos;s net pay {view.policy.employeePct}% and at least {naira(view.policy.minAmount)}.
      </p>
    </Section>
  );
}
