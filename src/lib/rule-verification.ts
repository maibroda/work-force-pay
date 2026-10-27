/**
 * Which statutory rules have been verified. Pure: no database, no framework.
 *
 * The bureau's Statutory Rule Library has HR and Finance each sign a rule version (neither the person who proposed it), and pins what they signed with a
 * checksum of the rule's content. A rule a client is about to be paid on is VERIFIED when its content is exactly what HR and Finance both signed, in a
 * release that has not been withdrawn. How the rule reached the client (published to it, or copied when it was onboarded) does not matter: only what it says.
 * A rule that was never put through the library (a "baseline"), or was changed after it was signed, is NOT verified.
 */
export type RuleKind = "TAX" | "PENSION" | "EMPLOYER_COST";
export const REQUIRED_RULE_KINDS: readonly RuleKind[] = ["TAX", "PENSION", "EMPLOYER_COST"];
export const RULE_KIND_NAMES: Record<RuleKind, string> = { TAX: "PAYE", PENSION: "pension", EMPLOYER_COST: "employer contribution" };

export interface InForceRule {
  kind: RuleKind;
  label: string;
  version: string;
  /** A fingerprint of everything that decides what the rule does. */
  fingerprint: string;
}

export interface Signature {
  slot: "HR" | "FINANCE";
  name: string;
  at: Date;
  /** The fingerprint of the rule at the moment this person signed it. */
  checksum: string;
}

export interface ReleaseFact {
  kind: RuleKind;
  version: string;
  checksum: string;
  status: "PROPOSED" | "VERIFIED" | "PUBLISHED" | "WITHDRAWN";
  signatures: readonly Signature[];
}

export interface RuleVerdict {
  kind: RuleKind;
  label: string;
  verified: boolean;
  reason: string;
  signedBy: Array<{ slot: "HR" | "FINANCE"; name: string; at: Date }>;
}

/** Higher is closer to verified, so the best of several matching releases decides what is reported. */
const RANK: Record<ReleaseFact["status"], number> = { PUBLISHED: 3, VERIFIED: 3, PROPOSED: 2, WITHDRAWN: 1 };

function bothSigned(r: ReleaseFact): boolean {
  const ok = r.signatures.filter((s) => s.checksum === r.checksum);
  return ok.some((s) => s.slot === "HR") && ok.some((s) => s.slot === "FINANCE");
}

/** The verdict for each required kind, in order. `inForce` holds the rule in force on the date for each kind; a missing kind is a failure. */
export function assessRules(inForce: Partial<Record<RuleKind, InForceRule>>, releases: readonly ReleaseFact[]): RuleVerdict[] {
  return REQUIRED_RULE_KINDS.map((kind): RuleVerdict => {
    const rule = inForce[kind];
    if (!rule) return { kind, label: RULE_KIND_NAMES[kind], verified: false, reason: `There is no ${RULE_KIND_NAMES[kind]} rule in force on this date.`, signedBy: [] };

    const same = releases.filter((r) => r.kind === kind && r.checksum === rule.fingerprint);
    const signed = same.find((r) => (r.status === "VERIFIED" || r.status === "PUBLISHED") && bothSigned(r));
    if (signed) {
      const by = (slot: "HR" | "FINANCE") => signed.signatures.find((s) => s.slot === slot && s.checksum === signed.checksum)!;
      const hr = by("HR");
      const fin = by("FINANCE");
      return {
        kind,
        label: rule.label,
        verified: true,
        reason: `Verified by HR (${hr.name}) and Finance (${fin.name}).`,
        signedBy: [hr, fin].map((s) => ({ slot: s.slot, name: s.name, at: s.at })),
      };
    }

    const fail = (reason: string): RuleVerdict => ({ kind, label: rule.label, verified: false, reason, signedBy: [] });
    const best = [...same].sort((a, b) => RANK[b.status] - RANK[a.status])[0];
    if (best?.status === "PROPOSED") return fail(`Waiting for HR and Finance (${new Set(best.signatures.filter((s) => s.checksum === best.checksum).map((s) => s.slot)).size} of 2 signed).`);
    if (best?.status === "WITHDRAWN") return fail("Its verification was withdrawn.");
    if (best) return fail("It is not signed by both HR and Finance.");
    if (releases.some((r) => r.kind === kind && r.version === rule.version))
      return fail("Changed since it was verified: the rule held no longer matches what HR and Finance signed.");
    return fail("Never put through verification in the Statutory Rule Library.");
  });
}
