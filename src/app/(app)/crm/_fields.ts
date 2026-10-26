import type { Field } from "@/components/smart-form";
import { CHANNELS, CHANNEL_LABELS, OUTCOMES, OUTCOME_LABELS, SEGMENTS, SEGMENT_LABELS, SOURCES, SOURCE_LABELS } from "@/lib/crm";

export const STAGE_TONE = { QUALIFIED: "blue", DISCOVERY: "blue", PROPOSAL: "amber", PILOT: "violet", WON: "green", LOST: "red" } as const;

type Option = { value: string; label: string };
type Lead = {
  company: string;
  segment: string;
  headcount: number | null;
  source: string;
  partnerId: string | null;
  contactName: string;
  contactRole: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  expectedMrr: unknown;
  nextStep: string | null;
  nextStepOn: Date | null;
  ownerUserId: string;
  notes: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

/** The fields of a lead, blank for a new one or filled from an existing one. */
export function leadFields(o: { owners: Option[]; partners: Option[]; lead?: Lead; me?: string }): Field[] {
  const l = o.lead;
  return [
    { name: "company", label: "Company", required: true, defaultValue: l?.company },
    { name: "segment", label: "Segment", type: "select", required: true, options: SEGMENTS.map((s) => ({ value: s, label: SEGMENT_LABELS[s] })), defaultValue: l?.segment ?? "SME" },
    { name: "headcount", label: "Staff (headcount)", type: "number", min: 1, defaultValue: l?.headcount ?? undefined },
    { name: "contactName", label: "Decision-maker", required: true, defaultValue: l?.contactName },
    { name: "contactRole", label: "Their role", defaultValue: l?.contactRole ?? undefined },
    { name: "contactEmail", label: "Email", type: "email", defaultValue: l?.contactEmail ?? undefined },
    { name: "contactPhone", label: "Phone", defaultValue: l?.contactPhone ?? undefined },
    { name: "source", label: "Where it came from", type: "select", required: true, options: SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] })), defaultValue: l?.source ?? "OUTBOUND" },
    { name: "partnerId", label: "Referral partner", type: "select", options: [{ value: "", label: "None" }, ...o.partners], defaultValue: l?.partnerId ?? "", help: "Choosing one makes the source a referral." },
    { name: "expectedMrr", label: "Expected monthly fee (₦)", type: "number", min: 0, defaultValue: l ? Number(l.expectedMrr) : 0 },
    { name: "ownerUserId", label: "Owner", type: "select", options: o.owners.map((x) => ({ value: x.value, label: x.label })), defaultValue: l?.ownerUserId ?? o.me },
    { name: "nextStep", label: "Next step", defaultValue: l?.nextStep ?? undefined },
    { name: "nextStepOn", label: "Next step on", type: "date", defaultValue: iso(l?.nextStepOn ?? null) },
    { name: "notes", label: "Notes", type: "textarea", span: 3, defaultValue: l?.notes ?? undefined },
  ];
}

/** An outreach entry. With `lead` set it is bound to that lead and asks only what happened. */
export function outreachFields(o: { withCompany: boolean; today: string }): Field[] {
  return [
    ...(o.withCompany
      ? ([
          { name: "company", label: "Company", required: true },
          { name: "contactName", label: "Who you spoke to" },
        ] as Field[])
      : []),
    { name: "channel", label: "How", type: "select", required: true, options: CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] })), defaultValue: "CALL" },
    { name: "outcome", label: "What came of it", type: "select", required: true, options: OUTCOMES.map((c) => ({ value: c, label: OUTCOME_LABELS[c] })), defaultValue: "NO_ANSWER" },
    { name: "date", label: "Date", type: "date", defaultValue: o.today, help: "Within the last 14 days." },
    ...(o.withCompany
      ? ([
          { name: "headcount", label: "Staff (if known)", type: "number", min: 1 },
          { name: "addAsLead", label: "Qualified: add this company to the pipeline", type: "checkbox" },
        ] as Field[])
      : []),
    { name: "note", label: "Note", type: "textarea", span: 3 },
  ];
}

type Pkg = { key: string; name: string; active: boolean };
type AddOn = { code: string; name: string; monthlyFee: number; perEmployeeFee: number; active: boolean };
type ProposalDefaults = { packageKey: string; headcount: number; termMonths: number; addOnCodes: string[]; extraHours: unknown; discountPct: unknown; discountReason: string | null };

/** A proposal's terms: the package, how many employees, the add-ons, and any discount. */
export function proposalFields(o: { packages: Pkg[]; addOns: AddOn[]; headcount?: number | null; p?: ProposalDefaults; showHours: boolean }): Field[] {
  const p = o.p;
  return [
    { name: "packageKey", label: "Package", type: "select", required: true, options: o.packages.filter((x) => x.active || x.key === p?.packageKey).map((x) => ({ value: x.key, label: x.name })), defaultValue: p?.packageKey },
    { name: "headcount", label: "Employees", type: "number", required: true, min: 1, defaultValue: p?.headcount ?? o.headcount ?? undefined },
    { name: "termMonths", label: "Term", type: "select", required: true, options: [{ value: "12", label: "12 months" }, { value: "6", label: "6 months" }], defaultValue: String(p?.termMonths ?? 12) },
    ...o.addOns.filter((a) => a.active || p?.addOnCodes.includes(a.code)).map((a) => ({ name: `addon_${a.code}`, label: `Add: ${a.name}`, type: "checkbox" as const, defaultValue: p?.addOnCodes.includes(a.code) ?? false })),
    ...(o.showHours ? ([{ name: "extraHours", label: "Extra delivery hours a month", type: "number", min: 0, defaultValue: Number(p?.extraHours ?? 0), help: "For what makes this client harder than the package assumes: several sites, shift allowances, ..." }] as Field[]) : []),
    { name: "discountPct", label: "Discount (%)", type: "number", min: 0, max: 100, defaultValue: Number(p?.discountPct ?? 0) },
    { name: "discountReason", label: "Why the discount", defaultValue: p?.discountReason ?? undefined, help: "Needed if there is one" },
  ];
}
