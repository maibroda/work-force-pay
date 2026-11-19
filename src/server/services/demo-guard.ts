/**
 * Demo companies cannot produce what a real company pays or files.
 *
 * A company made by the seed is marked `Organization.isDemo` (the founder's decision 9 of 2026-11-14; the design, including this block, approved on 2026-11-19). Its numbers are invented, so a demo
 * company must never produce a bank payment file, mark a payment batch paid, generate a statutory remittance or mark one remitted: a demo number can never be paid or filed. The founder chose to
 * BLOCK these outright rather than stamp a file as demo. Pure reads (the preview, the schedules and reports on screen) are not blocked.
 *
 * The flag is set only by the seed (`prisma/seed.ts`); no screen or action sets it, and a test proves nothing in `src` writes it.
 */
import { BusinessError, db, type Tx } from "./_base";

/** What a demo company cannot do, as it is named in the message the person sees. */
export type DemoBlocked = "a bank payment file" | "marking a payment batch as paid" | "a statutory remittance" | "marking a statutory remittance as remitted";

export async function assertNotDemo(orgId: string, what: DemoBlocked, client: Tx | typeof db = db) {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { isDemo: true } });
  if (org?.isDemo) throw new BusinessError(`This is a demo company, so ${what} is not available. Its numbers are invented, so they can never be paid or filed.`);
}
