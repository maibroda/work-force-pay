/**
 * Pure rules for withholding tax certificates. No database here.
 *
 * When a client withholds tax on paying us, they owe us a credit note or certificate as evidence; the tax authority credits the
 * tax against ours only on production of it. Receipts and deductions carry the certificate number the client quoted. The register
 * holds the certificates actually received, and the two are matched on client and number: what was withheld against a number is
 * compared with what the certificate says.
 */

const cents = (n: number) => Math.round(n * 100);

/** A certificate number reduced to what identifies it: upper case, with spaces and punctuation removed ("wht 77/A" = "WHT-77-A"). */
export function certificateKey(number: string): string {
  return number.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type MatchStatus = "MATCHED" | "CERT_SHORT" | "CERT_EXCEEDS" | "MISSING" | "NOT_RECORDED";

export const MATCH_LABELS: Record<MatchStatus, string> = {
  MATCHED: "Matched",
  CERT_SHORT: "Certificate is for less than was withheld",
  CERT_EXCEEDS: "Certificate is for more than was recorded",
  MISSING: "No certificate received",
  NOT_RECORDED: "Certificate received, no withholding recorded",
};

export const MATCH_HELP: Record<MatchStatus, string> = {
  MATCHED: "The certificate covers exactly what the client withheld.",
  CERT_SHORT: "The client withheld more than the certificate evidences. Ask them for a corrected certificate.",
  CERT_EXCEEDS: "The certificate says more tax was withheld than we recorded. Check the receipt.",
  MISSING: "Tax was withheld but no certificate is on the register. Chase the client.",
  NOT_RECORDED: "A certificate is on the register but no receipt or deduction quotes its number.",
};

export interface Withheld {
  clientId: string;
  /** The reference as typed on the receipt or deduction. */
  reference: string;
  amount: number;
  /** What recorded it, for the detail. */
  source: string;
}

export interface CertificateFacts {
  id: string;
  clientId: string;
  certificateNumber: string;
  amount: number;
}

export interface ReconciliationRow {
  clientId: string;
  key: string;
  /** The number as the certificate prints it, else as the receipt quoted it. */
  label: string;
  withheld: number;
  certified: number;
  difference: number;
  status: MatchStatus;
  sources: string[];
  certificateIds: string[];
}

/** Matches what clients withheld against the certificates received, by client and certificate number. */
export function reconcileCertificates(withheld: Withheld[], certificates: CertificateFacts[]): ReconciliationRow[] {
  const rows = new Map<string, ReconciliationRow>();
  const row = (clientId: string, key: string, label: string) => {
    const k = `${clientId}|${key}`;
    if (!rows.has(k)) rows.set(k, { clientId, key, label, withheld: 0, certified: 0, difference: 0, status: "MISSING", sources: [], certificateIds: [] });
    return rows.get(k)!;
  };
  for (const w of withheld) {
    const key = certificateKey(w.reference);
    const r = row(w.clientId, key, w.reference.trim() || "(no number)");
    r.withheld = (cents(r.withheld) + cents(w.amount)) / 100;
    r.sources.push(w.source);
  }
  for (const c of certificates) {
    const r = row(c.clientId, certificateKey(c.certificateNumber), c.certificateNumber);
    r.label = c.certificateNumber; // the printed number wins
    r.certified = (cents(r.certified) + cents(c.amount)) / 100;
    r.certificateIds.push(c.id);
  }
  for (const r of rows.values()) {
    r.difference = (cents(r.certified) - cents(r.withheld)) / 100;
    r.status = r.withheld === 0 ? "NOT_RECORDED" : r.certified === 0 ? "MISSING" : r.difference === 0 ? "MATCHED" : r.difference < 0 ? "CERT_SHORT" : "CERT_EXCEEDS";
  }
  return [...rows.values()].sort((a, b) => a.status.localeCompare(b.status) || a.label.localeCompare(b.label));
}

/** Withheld tax not yet evidenced: for each number, what was withheld beyond what its certificate covers. */
export function uncertified(rows: ReconciliationRow[]): number {
  return rows.reduce((s, r) => s + Math.max(0, cents(r.withheld) - cents(r.certified)), 0) / 100;
}
