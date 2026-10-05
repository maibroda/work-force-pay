import { cn } from "@/lib/utils";

const TONES = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "green",
  MAPPED: "green",
  APPROVED: "green",
  PAID: "green",
  PROCESSED: "blue",
  LOCKED: "violet",
  CLOSED: "gray",
  OPEN: "blue",
  CALCULATED: "blue",
  PENDING_VALIDATION: "amber",
  PENDING_APPROVAL: "amber",
  PENDING: "amber",
  PROCESSING: "amber",
  DRAFT: "gray",
  UNDERSTAFFED: "amber",
  OVERSTAFFED: "red",
  UNMAPPED: "red",
  INACTIVE: "gray",
  SUSPENDED: "amber",
  ON_LEAVE: "blue",
  TERMINATED: "red",
  RESIGNED: "gray",
  EXITED: "gray",
  REJECTED: "red",
  CANCELLED: "gray",
  FAILED: "red",
  ENDED: "gray",
  CRITICAL: "red",
  WARNING: "amber",
  INFO: "blue",
  PRESENT: "green",
  LATE: "amber",
  ABSENT: "red",
  LEAVE: "blue",
  OFF: "gray",
  REGULAR: "blue",
  SUPPLEMENTARY: "violet",
  SUPERSEDED: "gray",
  EXPIRED: "gray",
  ISSUED: "blue",
  PARTIALLY_PAID: "amber",
  OVERDUE: "red",
  DONE: "green",
  VALID: "green",
  REVOKED: "red",
  NOT_APPLICABLE: "gray",
  // HR lifecycle
  CLEARED: "green",
  WAIVED: "gray",
  ACCEPTED: "green",
  DECLINED: "red",
  SENT: "blue",
  WITHDRAWN: "gray",
  FILLED: "green",
  ON_HOLD: "amber",
  HIRED: "green",
  APPLIED: "gray",
  SCREENING: "blue",
  INTERVIEW: "blue",
  ASSESSMENT: "blue",
  OFFER: "violet",
  INVESTIGATING: "amber",
  HEARING: "violet",
  RESOLVED: "green",
  RELEASED: "violet",
  CONFIRMED: "green",
  EXTENDED: "amber",
  HIGH: "red",
  MEDIUM: "amber",
  LOW: "gray",
};

export function Badge({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONES[tone ?? "gray"],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{status.replace(/_/g, " ")}</Badge>;
}
