"use server";
import { actFor } from "./_run";
import * as rr from "@/server/services/retention-run";
const act = actFor("retention-run.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/retention-schedule"];

/** HR proposes a run for one kind of record: nothing is cleared until a different person confirms it. */
export async function proposeRunAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const run = await rr.proposeRun(ctx, String(v.category ?? ""));
    return { message: `Run proposed for ${run.itemCount} item(s). Nothing has been cleared: the Company Administrator has to confirm it, no sooner than a minute from now.` };
  }, PAGES);
}

/** The Company Administrator confirms: the reason is typed in the button's prompt. This clears the words for good. */
export async function confirmRunAction(id: string, note?: string) {
  return act("retention.manage", async (ctx) => {
    const run = await rr.confirmRun(ctx, id, note ?? "");
    return { message: `Done. ${run.clearedItems ?? 0} item(s) cleared, ${run.skippedAtConfirm ?? 0} left out.` };
  }, PAGES);
}

/** Turning a proposal down: the Company Administrator, or the person who proposed it. The service decides which; a reason is typed in the prompt. */
export async function rejectRunAction(id: string, note?: string) {
  return act("hr.manage", async (ctx) => {
    await rr.rejectRun(ctx, id, note ?? "");
    return { message: "Run turned down. Nothing was cleared." };
  }, PAGES);
}
