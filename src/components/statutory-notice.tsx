import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { statutoryStatus } from "@/server/services/statutory-verification";

type Status = Awaited<ReturnType<typeof statutoryStatus>>;

/**
 * Whether the statutory rules this payroll is calculated on have been verified by HR and Finance (rule 3), in plain words.
 * A production client with an unverified rule is BLOCKED; a client still being set up is told, but not stopped.
 */
export function StatutoryNotice({ status }: { status: Status }) {
  if (!status.bureauClient) return null;
  if (status.unverified.length) {
    const blocked = status.gated;
    return (
      <div role="alert" className={cn("mb-4 rounded-lg border px-4 py-3 text-sm", blocked ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
        <p className="font-medium">
          {blocked ? "Payroll is blocked: a statutory rule has not been verified." : "A statutory rule has not been verified yet."}
        </p>
        <ul className="mt-1 list-disc pl-5">
          {status.unverified.map((v) => (
            <li key={v.kind}>
              <strong>{v.label}</strong>: {v.reason}
            </li>
          ))}
        </ul>
        <p className="mt-1">
          {blocked
            ? "This payroll can't be calculated, submitted, approved or locked until HR and Finance have verified it in the bureau's Statutory Rule Library."
            : "This client is still being set up, so payroll is not stopped. It will be once the client goes live."}
        </p>
      </div>
    );
  }
  return (
    <p className="mb-4 text-xs text-slate-500">
      Statutory rules verified:{" "}
      {status.verdicts.map((v, i) => (
        <span key={v.kind}>
          {i ? "; " : ""}
          {v.label} (HR {v.signedBy.find((s) => s.slot === "HR")?.name}, Finance {v.signedBy.find((s) => s.slot === "FINANCE")?.name}, {fmtDate(v.signedBy[v.signedBy.length - 1]?.at)})
        </span>
      ))}
      .
    </p>
  );
}
