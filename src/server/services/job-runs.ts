/**
 * Scheduled jobs leave a trace each time they are called, so the app can tell whether a scheduler is really calling them (the launch
 * checklist reads it). A failing job is recorded as failed and the error still reaches the caller.
 */
import type { JobName } from "@/lib/launch-readiness";
import { db } from "./_base";

const KEEP_DAYS = 90;

export async function recordJob<T>(name: JobName, fn: () => Promise<T>): Promise<T> {
  const run = await db.jobRun.create({ data: { name } });
  // old rows are cleared as a side effect, so nobody has to schedule that too
  await db.jobRun.deleteMany({ where: { name, startedAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } }).catch(() => undefined);
  try {
    const result = await fn();
    await db.jobRun.update({ where: { id: run.id }, data: { ok: true, finishedAt: new Date() } });
    return result;
  } catch (e) {
    await db.jobRun.update({ where: { id: run.id }, data: { ok: false, finishedAt: new Date(), error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } }).catch(() => undefined);
    throw e;
  }
}
