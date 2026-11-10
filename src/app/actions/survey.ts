"use server";
import { actFor } from "./_run";
import * as sv from "@/server/services/survey";
import { BusinessError, db } from "@/server/services/_base";
const act = actFor("survey.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/surveys", "/me/surveys"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

/** The answers of one form: each question is a field named q_<id>. Whatever the form sends, the service checks it against the survey's own questions. */
function answersFrom(v: V) {
  return Object.entries(v)
    .filter(([k]) => k.startsWith("q_"))
    .map(([k, val]) => ({ questionId: k.slice(2), value: typeof val === "string" && /^\d+$/.test(val) ? Number(val) : undefined, comment: typeof val === "string" && !/^\d+$/.test(val) ? val : undefined }));
}

// ── HR builds and runs a survey ──
export async function createSurveyAction(v: V) {
  return act("survey.manage", async (ctx) => {
    const s = await sv.createSurvey(ctx, { title: str(v.title) ?? "", intro: str(v.intro), categoryId: str(v.categoryId) || null, departmentId: str(v.departmentId) || null, opensOn: str(v.opensOn) ?? "", closesOn: str(v.closesOn) ?? "" });
    return { message: "Survey created. Add its questions, then open it.", redirectTo: `/hr/surveys/${s.id}` };
  }, PAGES);
}

export async function addQuestionAction(surveyId: string, v: V) {
  return act("survey.manage", async (ctx) => {
    await sv.addQuestion(ctx, surveyId, { kind: (str(v.kind) ?? "SCALE") as "SCALE" | "COMMENT", text: str(v.text) ?? "" });
    return { message: "Question added." };
  }, PAGES);
}

export async function removeQuestionAction(questionId: string) {
  return act("survey.manage", async (ctx) => {
    await sv.removeQuestion(ctx, questionId);
    return { message: "Question removed." };
  }, PAGES);
}

/** Opening returns the sheet of access codes ONCE, in the result, for the page to show and print. Only hashes are stored. */
export async function openSurveyAction(surveyId: string) {
  return act("survey.manage", async (ctx) => {
    const { sheet } = await sv.openSurvey(ctx, surveyId);
    return { message: `Survey opened. ${sheet.length} access codes were made: print the sheet now, it is not shown again.`, data: { sheet } };
    // no revalidation here: re-rendering the page into its "open" state would remove the sheet before it can be printed; the sheet's own "I have printed it" button refreshes the page
  }, []);
}

export async function closeSurveyAction(surveyId: string) {
  return act("survey.manage", async (ctx) => {
    await sv.closeSurvey(ctx, surveyId);
    return { message: "Survey closed. The results are now available." };
  }, PAGES);
}

export async function setFollowUpAction(surveyId: string, v: V) {
  return act("survey.manage", async (ctx) => {
    await sv.setFollowUp(ctx, surveyId, str(v.followUp) ?? "");
    return { message: "Saved. Every invited employee can read it." };
  }, PAGES);
}

export async function hideCommentAction(answerId: string, reason?: string) {
  return act("survey.manage", async (ctx) => {
    await sv.hideComment(ctx, answerId, reason ?? "");
    return { message: "Comment hidden." };
  }, PAGES);
}

/** A lost code is reissued by employee number; the new code is returned once. */
export async function reissueCodeAction(surveyId: string, v: V) {
  return act("survey.manage", async (ctx) => {
    const number = str(v.employeeNumber)?.trim();
    if (!number) throw new BusinessError("Enter the employee number.");
    const emp = await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    const { code } = await sv.reissueCode(ctx, surveyId, emp.id);
    return { message: `New code: ${code}. Give it to the employee now; it is not shown again.`, data: { code } };
  }, PAGES);
}

export async function startAssistedSessionAction(surveyId: string, v: V) {
  return act("survey.assist", async (ctx) => {
    const { path } = await sv.startKioskSession(ctx, surveyId, str(v.deviceLabel) ?? "");
    return { message: "Session recorded. Open the survey page on the device and hand it to the employee: they type their own code and answer alone.", redirectTo: path };
  }, PAGES);
}

export async function runSurveyRetentionAction() {
  return act("survey.manage", async (ctx) => {
    const r = await sv.purgeExpired(ctx);
    return { message: r.surveys ? `Deleted the raw answers of ${r.surveys} survey(s) (${r.responses} submissions); the anonymised results are kept.` : "Nothing is past its retention period." };
  }, PAGES);
}

// ── An employee with a login answers: a login is enough, and the service checks the invitation ──
export async function submitMySurveyAction(surveyId: string, v: V) {
  return act(undefined, async (ctx) => {
    await sv.submitAsEmployee(ctx, surveyId, answersFrom(v));
    return { message: "Thank you. Your answers are anonymous: nobody can tell which answers are yours." };
  }, PAGES);
}
