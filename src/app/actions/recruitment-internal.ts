"use server";
import { actFor } from "./_run";
import * as ri from "@/server/services/recruitment-internal";
const act = actFor("recruitment-internal.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/requisitions", "/hr/candidates", "/me/vacancies"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

// ── HR publishes inside the company ──
export async function publishVacancyAction(requisitionId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await ri.publishVacancy(ctx, requisitionId, { deadline: str(v.deadline) ?? "", summary: str(v.summary) ?? "" });
    return { message: "Vacancy published inside the company." };
  }, PAGES);
}

export async function unpublishVacancyAction(requisitionId: string) {
  return act("hr.manage", async (ctx) => {
    await ri.unpublishVacancy(ctx, requisitionId);
    return { message: "Vacancy taken down. Applications already made stay." };
  }, PAGES);
}

// ── HR starts the move for a selected internal applicant: a promotion proposal, nothing else ──
export async function startInternalMoveAction(candidateId: string, v: V) {
  return act("recruitment.assess", async (ctx) => {
    await ri.startInternalMove(ctx, candidateId, { intendedOn: str(v.intendedOn) ?? "", reason: str(v.reason) ?? "" });
    return { message: "Promotion proposal started. A different HR person approves it; nobody is told by the system." };
  }, [...PAGES, "/hr/promotions", "/me/career"]);
}

// ── An employee applies: any signed-in employee; the service checks the vacancy and the person ──
export async function applyInternallyAction(requisitionId: string, v: V) {
  return act(undefined, async (ctx) => {
    await ri.applyInternally(ctx, requisitionId, str(v.note));
    return { message: "Your application was sent to HR. Nobody else is told, including your manager." };
  }, PAGES);
}
