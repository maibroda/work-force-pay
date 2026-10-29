/**
 * Stage gates: what must be filled before a deal may enter a stage. Each stage stores a list of requirement keys; this turns the facts about a deal into
 * the plain-language list of what is still missing. A key it does not know BLOCKS (it is reported), never passes quietly. The "quote" requirement is
 * evaluated only once quotes exist (`hasQuote` is then true or false); until then it is skipped, and it is switched on with the quote builder.
 */
export interface GateFacts {
  monthlyContractValue: unknown;
  expectedStartDate: Date | string | null;
  contractTermMonths: number | null;
  primaryContactId: string | null;
  /** How many active contacts the deal's account has. */
  accountContactCount: number;
  lostReason: string | null;
  /** null while the quote builder does not exist for this organization: the requirement is then not checked. */
  hasQuote: boolean | null;
}

export const GATE_LABELS: Record<string, string> = {
  monthlyContractValue: "a monthly contract value above zero",
  expectedStartDate: "the expected start date",
  contractTermMonths: "the contract term in months",
  contact: "a contact on the deal (or at least one on its account)",
  quote: "a quote that has been sent or accepted",
  lostReason: "the reason it was lost",
};

const positive = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
};

export function missingForStage(required: readonly string[], f: GateFacts): string[] {
  const out: string[] = [];
  for (const key of required) {
    let ok: boolean;
    switch (key) {
      case "monthlyContractValue": ok = positive(f.monthlyContractValue); break;
      case "expectedStartDate": ok = !!f.expectedStartDate; break;
      case "contractTermMonths": ok = (f.contractTermMonths ?? 0) >= 1; break;
      case "contact": ok = !!f.primaryContactId || f.accountContactCount > 0; break;
      case "quote": ok = f.hasQuote === null ? true : f.hasQuote; break;
      case "lostReason": ok = !!f.lostReason; break;
      default: out.push(`(an unknown requirement "${key}")`); continue;
    }
    if (!ok) out.push(GATE_LABELS[key]);
  }
  return out;
}
