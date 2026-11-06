"use server";
import { actFor } from "./_run";
import * as perf from "@/server/services/performance";
import { BusinessError } from "@/server/services/_base";
import { parseBandLines } from "@/lib/performance";
const act = actFor("performance.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr"];

export async function createJobDescriptionAction(v: V) {
  return act("appraisal.manage", async (ctx) => {
    const jd = await perf.createJobDescription(ctx, { ...v, copyFromActive: true } as never);
    return { message: `Draft version ${jd.version} created.`, redirectTo: `/hr/job-descriptions/${jd.id}` };
  }, PAGES);
}
export async function updateJobDescriptionAction(id: string, v: V) {
  return act("appraisal.manage", async (ctx) => {
    await perf.updateJobDescription(ctx, id, v as never);
    return { message: "Saved." };
  }, PAGES);
}
export async function addKpiAction(jobDescriptionId: string, v: V) {
  return act("appraisal.manage", async (ctx) => {
    await perf.addKpi(ctx, jobDescriptionId, v as never);
    return { message: "KPI added." };
  }, PAGES);
}
export async function removeKpiAction(id: string) {
  return act("appraisal.manage", async (ctx) => {
    await perf.removeKpi(ctx, id);
    return { message: "KPI removed." };
  }, PAGES);
}
export async function activateJobDescriptionAction(id: string) {
  return act("hr.approve", async (ctx) => {
    await perf.activateJobDescription(ctx, id);
    return { message: "Job description is now active. The previous version is retired." };
  }, PAGES);
}
export async function discardDraftAction(id: string) {
  return act("appraisal.manage", async (ctx) => {
    await perf.discardDraft(ctx, id);
    return { message: "Draft discarded.", redirectTo: "/hr/job-descriptions" };
  }, PAGES);
}
export async function updateKpiBandsAction(v: V) {
  return act("hr.configure", async (ctx) => {
    let bands;
    try {
      bands = parseBandLines(String(v.bands ?? ""));
    } catch (e) {
      throw new BusinessError((e as Error).message);
    }
    await perf.updateKpiBands(ctx, bands);
    return { message: "Bands saved. They apply to reviews submitted from now on." };
  }, PAGES);
}
