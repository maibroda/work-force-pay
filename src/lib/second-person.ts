/**
 * The second-person rule (governance step 2b, docs/plans/hr-governance-step2-plan.md): the person who did the work does not also sign it off. Closing a relations case is not done by
 * the person who resolved it; a sanction is not approved by the person who raised it; a new succession nomination is not approved by the person who made it.
 *
 * So that a small company is not stuck, where the actor is the ONLY holder of the right needed (nobody else could do it), they may, with a written reason of at least 20 characters,
 * and the record is flagged "single holder". It is never available while another holder exists. Pure rule, no database: the service works out who else holds the right.
 */

export const SINGLE_HOLDER_REASON_MIN = 20;

export function checkSingleHolderReason(reason: string | null | undefined): string | null {
  return (reason ?? "").trim().length >= SINGLE_HOLDER_REASON_MIN ? null : `Give your reason (at least ${SINGLE_HOLDER_REASON_MIN} characters).`;
}

export type SecondPerson = { ok: true; singleHolder: boolean } | { ok: false; error: string };

export function secondPerson(x: {
  /** The person signing off is the person who did the work. */
  samePerson: boolean;
  /** How many other people (not the actor) hold the right needed to sign off. */
  otherHolders: number;
  reason: string | null | undefined;
  /** What the actor did, and what the other person does: "resolved this case" / "closes it". */
  did: string;
  does: string;
}): SecondPerson {
  if (!x.samePerson) return { ok: true, singleHolder: false };
  if (x.otherHolders > 0) return { ok: false, error: `You ${x.did}, so a different person ${x.does}.` };
  const bad = checkSingleHolderReason(x.reason);
  if (bad) return { ok: false, error: `You ${x.did} and you are the only person who can sign it off: ${bad.charAt(0).toLowerCase()}${bad.slice(1)}` };
  return { ok: true, singleHolder: true };
}
