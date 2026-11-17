/**
 * Internal moves and the positions on a requisition (recruitment slice B, part 2; docs/plans/internal-selection-plan.md, S1 and S6).
 *
 * A vacancy has `headcount` positions. They are taken by OUTSIDE HIRES (candidates at the HIRED stage) and by INTERNAL MOVES: promotion proposals started from an internal applicant's candidate
 * record. An internal move is not a hire (no recruitment figure counts it as one), but it does take a position, from the moment it is started (so a live move holds its position against an
 * outside hire) until it is declined or withdrawn (which gives the position back). It FILLS the position only when the promotion has been applied.
 */
import type { Prisma } from "@prisma/client";

/** The promotion statuses in which a move still holds its position. */
export const LIVE_MOVE = ["PROPOSED", "APPROVED", "APPLIED"] as const;

type Client = Pick<Prisma.TransactionClient, "candidate" | "promotionProposal" | "jobRequisition">;

/** Positions taken: outside hires plus internal moves that are live (proposed, approved or applied). Used to refuse a hire or a move when none is left. */
export async function takenPositions(client: Client, requisitionId: string): Promise<number> {
  const [hired, moves] = await Promise.all([
    client.candidate.count({ where: { requisitionId, stage: "HIRED" } }),
    client.promotionProposal.count({ where: { candidate: { requisitionId }, status: { in: [...LIVE_MOVE] } } }),
  ]);
  return hired + moves;
}

/** Positions actually filled: outside hires plus internal moves whose promotion has been applied. The requisition is FILLED when this reaches its headcount. */
export async function filledPositions(client: Client, requisitionId: string): Promise<number> {
  const [hired, moves] = await Promise.all([
    client.candidate.count({ where: { requisitionId, stage: "HIRED" } }),
    client.promotionProposal.count({ where: { candidate: { requisitionId }, status: "APPLIED" } }),
  ]);
  return hired + moves;
}

/**
 * Called inside the transaction that marks a promotion applied, when the promotion was started from an internal applicant: the candidate becomes MOVED (not HIRED), and the requisition is
 * FILLED once every position is filled.
 */
export async function completeInternalMove(tx: Client, candidateId: string): Promise<void> {
  const c = await tx.candidate.findUnique({ where: { id: candidateId }, select: { id: true, requisitionId: true, requisition: { select: { headcount: true, status: true } } } });
  if (!c) return;
  await tx.candidate.update({ where: { id: c.id }, data: { stage: "MOVED", stageChangedAt: new Date() } });
  if (c.requisition.status !== "FILLED" && (await filledPositions(tx, c.requisitionId)) >= c.requisition.headcount) await tx.jobRequisition.update({ where: { id: c.requisitionId }, data: { status: "FILLED" } });
}
