import type { Field } from "@/components/smart-form";
import { enumOptions } from "@/server/options";

type Opts = { value: string; label: string }[];

export function contractFields(o: { clients: Opts; activeStructures: Opts }, clientId?: string): Field[] {
  return [
    clientId
      ? { name: "clientId", label: "", type: "hidden", defaultValue: clientId }
      : { name: "clientId", label: "Client", type: "select", required: true, options: o.clients },
    { name: "name", label: "Contract name", required: true },
    { name: "contractNumber", label: "Contract number", help: "Blank = auto-generate" },
    { name: "startDate", label: "Start date", type: "date", required: true },
    { name: "endDate", label: "End date", type: "date" },
    { name: "contractValue", label: "Contract value (₦)", type: "number", min: 0 },
    {
      name: "billingMethod",
      label: "Billing method",
      type: "select",
      options: enumOptions(["PER_HEAD_MONTHLY", "LUMP_SUM_MONTHLY", "PER_SHIFT"]),
      defaultValue: "PER_HEAD_MONTHLY",
    },
    {
      name: "businessLine",
      label: "Business line",
      type: "select",
      required: true,
      options: [
        { value: "GUARDING", label: "Guarding" },
        { value: "OUTSOURCING", label: "Outsourcing / Resourcing" },
      ],
      defaultValue: "GUARDING",
      help: "Drives ITF, NSITF, insurance, uniform & kits, recruitment/training and leave reliever costs.",
    },
    {
      name: "operativeSharePct",
      label: "Operative share % (sharing ratio)",
      type: "number",
      min: 1,
      max: 100,
      defaultValue: 70,
      help: "70 = 70:30 — 70% to operatives, 30% management cost",
    },
    { name: "defaultStructureId", label: "Salary structure", type: "select", options: o.activeStructures },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: enumOptions(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]),
      defaultValue: "ACTIVE",
    },
    { name: "notes", label: "Notes", type: "textarea", span: 3 },
  ];
}

export function beatFields(contracts: Opts): Field[] {
  return [
    { name: "contractId", label: "Contract", type: "select", required: true, options: contracts },
    { name: "name", label: "Beat / location name", required: true },
    { name: "code", label: "Beat code", help: "Blank = auto-generate" },
    { name: "bidReference", label: "Bid reference" },
    { name: "region", label: "Region" },
    { name: "state", label: "State" },
    { name: "lga", label: "LGA" },
    { name: "address", label: "Full address", span: 2 },
    { name: "siteContact", label: "Site contact" },
    {
      name: "approvedStrength",
      label: "Approved strength (manpower)",
      type: "number",
      required: true,
      min: 0,
    },
    { name: "startDate", label: "Start date", type: "date" },
  ];
}
