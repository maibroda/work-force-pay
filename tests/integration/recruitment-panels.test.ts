import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { anonymizeStaleCandidates } from "@/server/services/retention";
import { addCandidate, approveRequisition, createOffer, createRequisition, getCandidate, moveCandidate, recordInterviewFeedback, scheduleInterview } from "@/server/services/recruitment";
import {
  closePanel,
  comparison,
  decideSelection,
  getMyScorecard,
  listCriteria,
  mySeats,
  recommendSelection,
  setCriteria,
  setPanel,
  submitScorecard,
} from "@/server/services/recruitment-panel";
import { isolatedOrg, uid } from "../helpers";

// Interview panels, scorecards and the comparison page (slice A of the recruitment plan, approved by the founder on 2026-11-16).
// Advice only: nothing here ranks, filters or rejects a candidate. A panel member scores through their seat; HR sets up the panel and the criteria; scorecards are blind until the
// interview is closed; the chair recommends and a second person approves before an offer; interview feedback is read by HR and the panel only, and every read is logged.

type T = Awaited<ReturnType<typeof isolatedOrg>>;
const SECRET = "PANEL-SECRET-COMMENT the candidate was rude to the cleaner";
const inDays = (n: number) => iso(addDays(todayUtc(), n));

async function login(t: T, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@panel.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

/** An approved requisition with three criteria, four staff who can sit on a panel (each with a login), one candidate and one interview. */
async function setup() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const boss = t.ctx("COMPANY_ADMIN");
  const req = await createRequisition(hr, { title: "Site Supervisor", categoryId: t.guardId, departmentId: t.deptId, headcount: 1, employmentType: "PERMANENT", justification: "New client site going live" });
  await approveRequisition(boss, req.id);
  await setCriteria(hr, req.id, ["Relevant experience", "Communication", "Reliability"]);
  const criteria = await listCriteria(hr, req.id);
  const staff: Array<{ id: string; ctx: Ctx; name: string }> = [];
  for (let i = 0; i < 6; i++) {
    const emp = await createEmployee(hr, { firstName: "Panel", lastName: `Member${i}`, employmentDate: "2022-01-05", categoryId: t.officeId });
    staff.push({ id: emp.id, ctx: await login(t, i === 0 ? "SUPERVISOR" : "EMPLOYEE", emp.id), name: `Panel Member${i}` });
  }
  const candidate = await addCandidate(hr, { requisitionId: req.id, firstName: "Ngozi", lastName: "Candidate", source: "REFERRAL" });
  const interview = await scheduleInterview(hr, { candidateId: candidate.id, scheduledAt: inDays(2), interviewer: "Panel", mode: "IN_PERSON" });
  return { t, hr, boss, req, criteria, staff, candidate, interview };
}
type W = Awaited<ReturnType<typeof setup>>;

/** Chair = staff[0]; members = staff[1], staff[2]. */
async function withPanel(w: W, interviewId = w.interview.id) {
  await setPanel(w.hr, interviewId, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [w.staff[1].id, w.staff[2].id] });
}
const card = (w: W, scores: number[], recommendation: "STRONG_HIRE" | "HIRE" | "NO_HIRE" | "STRONG_NO_HIRE" = "HIRE", comment?: string) => ({
  scores: w.criteria.map((c, i) => ({ criterionId: c.id, score: scores[i], comment: i === 0 ? comment : undefined })),
  recommendation,
  comment,
});

describe("the right to set up and read assessments", () => {
  it("is held by the HR administrator alone: not the administrators, finance, the auditor, a manager or an employee", () => {
    const holders = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes("recruitment.assess"));
    expect(holders).toEqual(["HR_ADMIN"]);
  });
});

describe("a requisition's scoring criteria", () => {
  it("are three to six, named, different from one another, and set by HR alone", async () => {
    const w = await setup();
    const req2 = await createRequisition(w.hr, { title: "Driver", categoryId: w.t.guardId, headcount: 1, employmentType: "PERMANENT", justification: "Replace a leaver" });
    await approveRequisition(w.boss, req2.id);
    await expect(setCriteria(w.hr, req2.id, ["One", "Two"])).rejects.toThrow(/three to six/i);
    await expect(setCriteria(w.hr, req2.id, ["A1", "B2", "C3", "D4", "E5", "F6", "G7"])).rejects.toThrow(/three to six/i);
    await expect(setCriteria(w.hr, req2.id, ["Same", "Same", "Other"])).rejects.toThrow(/different/i);
    await expect(setCriteria(w.hr, req2.id, ["Fine", "  ", "Other"])).rejects.toThrow();
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.staff[0].ctx, w.staff[1].ctx]) await expect(setCriteria(ctx, req2.id, ["A1", "B2", "C3"]), ctx.role).rejects.toThrow(/permission/);
    await setCriteria(w.hr, req2.id, ["Driving record", "Route knowledge", "Calm under pressure"]);
    expect((await listCriteria(w.hr, req2.id)).map((c) => c.name)).toEqual(["Driving record", "Route knowledge", "Calm under pressure"]);
  });
  it("can be changed until the first scorecard is submitted, and not after", async () => {
    const w = await setup();
    await setCriteria(w.hr, w.req.id, ["Experience", "Attitude", "Punctuality", "Initiative"]);
    expect(await listCriteria(w.hr, w.req.id)).toHaveLength(4);
    await withPanel(w);
    const crit = await listCriteria(w.hr, w.req.id);
    await submitScorecard(w.staff[1].ctx, w.interview.id, { scores: crit.map((c) => ({ criterionId: c.id, score: 3 })), recommendation: "HIRE" });
    await expect(setCriteria(w.hr, w.req.id, ["Other 1", "Other 2", "Other 3"])).rejects.toThrow(/scorecard/i);
  });
  it("belong to the company: another company's HR cannot read or set them", async () => {
    const w = await setup();
    const o = await isolatedOrg();
    await expect(listCriteria(o.ctx("HR_ADMIN"), w.req.id)).rejects.toThrow(/not found/i);
    await expect(setCriteria(o.ctx("HR_ADMIN"), w.req.id, ["A1", "B2", "C3"])).rejects.toThrow(/not found/i);
  });
});

describe("an interview's panel", () => {
  it("is two to five employees with a login, one of them the chair, set by HR before anyone scores", async () => {
    const w = await setup();
    await expect(setPanel(w.hr, w.interview.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [] })).rejects.toThrow(/two to five/i);
    await expect(setPanel(w.hr, w.interview.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [w.staff[1].id, w.staff[2].id, w.staff[3].id, w.staff[4].id, w.staff[5].id] })).rejects.toThrow(/two to five/i);
    await expect(setPanel(w.hr, w.interview.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [w.staff[0].id] })).rejects.toThrow(/two to five|once/i);
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.staff[0].ctx]) await expect(setPanel(ctx, w.interview.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [w.staff[1].id] }), ctx.role).rejects.toThrow(/permission/);
    await withPanel(w);
    const members = await db.interviewPanelMember.findMany({ where: { interviewId: w.interview.id } });
    expect(members).toHaveLength(3);
    expect(members.filter((m) => m.isChair).map((m) => m.employeeId)).toEqual([w.staff[0].id]);
  });
  it("needs the criteria first, a person with a login, a person still employed, and a person of this company", async () => {
    const w = await setup();
    const req2 = await createRequisition(w.hr, { title: "Cleaner", categoryId: w.t.guardId, headcount: 1, employmentType: "PERMANENT", justification: "New site" });
    await approveRequisition(w.boss, req2.id);
    const c2 = await addCandidate(w.hr, { requisitionId: req2.id, firstName: "No", lastName: "Criteria", source: "OTHER" });
    const iv2 = await scheduleInterview(w.hr, { candidateId: c2.id, scheduledAt: inDays(3), interviewer: "Panel" });
    await expect(setPanel(w.hr, iv2.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [w.staff[1].id] })).rejects.toThrow(/criteria/i);
    const noLogin = await createEmployee(w.hr, { firstName: "No", lastName: "Login", employmentDate: "2022-01-05", categoryId: w.t.officeId });
    await expect(setPanel(w.hr, w.interview.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [noLogin.id] })).rejects.toThrow(/login/i);
    await db.employee.update({ where: { id: w.staff[3].id }, data: { status: "EXITED" } });
    await expect(setPanel(w.hr, w.interview.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [w.staff[3].id] })).rejects.toThrow(/no longer|employed|active/i);
    const o = await isolatedOrg();
    const stranger = await createEmployee(o.ctx("HR_ADMIN"), { firstName: "Else", lastName: "Where", employmentDate: "2022-01-05", categoryId: o.officeId });
    await expect(setPanel(w.hr, w.interview.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [stranger.id] })).rejects.toThrow(/not found/i);
  });
  it("cannot change once a scorecard is in, and cannot be set on an interview already scored the old way", async () => {
    const w = await setup();
    await withPanel(w);
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [3, 3, 3]));
    await expect(setPanel(w.hr, w.interview.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [w.staff[1].id, w.staff[3].id] })).rejects.toThrow(/scorecard/i);
    const c2 = await addCandidate(w.hr, { requisitionId: w.req.id, firstName: "Old", lastName: "Way", source: "WALK_IN" });
    const iv2 = await scheduleInterview(w.hr, { candidateId: c2.id, scheduledAt: inDays(2), interviewer: "Ada" });
    await recordInterviewFeedback(w.hr, iv2.id, { score: 4, recommendation: "HIRE", feedback: "Solid interview" });
    await expect(setPanel(w.hr, iv2.id, { chairEmployeeId: w.staff[0].id, memberEmployeeIds: [w.staff[1].id] })).rejects.toThrow(/already|recorded/i);
  });
  it("means the interview is scored by the panel: the old single feedback is refused for it", async () => {
    const w = await setup();
    await withPanel(w);
    await expect(recordInterviewFeedback(w.hr, w.interview.id, { score: 4, recommendation: "HIRE", feedback: "One person's view" })).rejects.toThrow(/panel/i);
  });
});

describe("a panel member's seat", () => {
  it("shows a member only their own interviews, and a person on no panel nothing", async () => {
    const w = await setup();
    await withPanel(w);
    const mine = await mySeats(w.staff[1].ctx);
    expect(mine.map((s) => s.interviewId)).toEqual([w.interview.id]);
    expect(Object.keys(mine[0]).sort()).toEqual(["candidateName", "closed", "interviewId", "jobTitle", "round", "scheduledAt", "submitted"]);
    expect(await mySeats(w.staff[4].ctx)).toEqual([]);
    await expect(getMyScorecard(w.staff[4].ctx, w.interview.id)).rejects.toThrow(/not on this panel/i);
    await expect(submitScorecard(w.staff[4].ctx, w.interview.id, card(w, [3, 3, 3]))).rejects.toThrow(/not on this panel/i);
  });
  it("does not open another company's interview", async () => {
    const w = await setup();
    await withPanel(w);
    const o = await isolatedOrg();
    const e = await createEmployee(o.ctx("HR_ADMIN"), { firstName: "Else", lastName: "Where", employmentDate: "2022-01-05", categoryId: o.officeId });
    const stranger = await login(o, "EMPLOYEE", e.id);
    await expect(getMyScorecard(stranger, w.interview.id)).rejects.toThrow(/not on this panel/i);
    expect(await mySeats(stranger)).toEqual([]);
  });
});

describe("a scorecard", () => {
  it("scores every criterion from 1 to 5 and gives a recommendation, and can be corrected until the panel is closed", async () => {
    const w = await setup();
    await withPanel(w);
    const m = w.staff[1].ctx;
    await expect(submitScorecard(m, w.interview.id, { scores: w.criteria.slice(0, 2).map((c) => ({ criterionId: c.id, score: 3 })), recommendation: "HIRE" })).rejects.toThrow(/every criterion/i);
    await expect(submitScorecard(m, w.interview.id, card(w, [3, 6, 3]))).rejects.toThrow(/1 to 5/);
    await expect(submitScorecard(m, w.interview.id, card(w, [3, 0, 3]))).rejects.toThrow(/1 to 5/);
    await expect(submitScorecard(m, w.interview.id, card(w, [3, 2.5, 3]))).rejects.toThrow(/1 to 5/);
    await expect(submitScorecard(m, w.interview.id, { scores: [{ criterionId: "not-a-criterion", score: 3 }, ...w.criteria.slice(1).map((c) => ({ criterionId: c.id, score: 3 }))], recommendation: "HIRE" })).rejects.toThrow();
    await submitScorecard(m, w.interview.id, card(w, [3, 3, 3], "HIRE"));
    await submitScorecard(m, w.interview.id, card(w, [5, 4, 4], "STRONG_HIRE"));
    const mine = await getMyScorecard(m, w.interview.id);
    expect(mine.mine!.scores.map((s) => s.score)).toEqual([5, 4, 4]);
    expect(mine.mine!.recommendation).toBe("STRONG_HIRE");
    expect(await db.scorecardScore.count({ where: { panelMember: { interviewId: w.interview.id } } })).toBe(3);
  });
  it("closes the panel when the last member has submitted, completes the interview, and cannot be changed afterwards", async () => {
    const w = await setup();
    await withPanel(w);
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [4, 4, 4]));
    await submitScorecard(w.staff[2].ctx, w.interview.id, card(w, [3, 3, 3]));
    expect((await db.interview.findUniqueOrThrow({ where: { id: w.interview.id } })).panelClosedAt).toBeNull();
    await submitScorecard(w.staff[0].ctx, w.interview.id, card(w, [5, 5, 5], "STRONG_HIRE"));
    const iv = await db.interview.findUniqueOrThrow({ where: { id: w.interview.id } });
    expect(iv.panelClosedAt).not.toBeNull();
    expect(iv.completedAt).not.toBeNull();
    // the old single score and recommendation are left alone: a panelled interview has none
    expect(iv.score).toBeNull();
    expect(iv.recommendation).toBeNull();
    await expect(submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [1, 1, 1]))).rejects.toThrow(/closed/i);
    // and the candidate can now be moved to the offer stage, as after an old-style interview
    await moveCandidate(w.hr, w.candidate.id, "OFFER");
  });
  it("is blind: until the panel is closed no member sees another's scorecard, and HR sees only how many have submitted", async () => {
    const w = await setup();
    await withPanel(w);
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [1, 1, 1], "STRONG_NO_HIRE", SECRET));
    const seen = await getMyScorecard(w.staff[2].ctx, w.interview.id);
    expect(seen.closed).toBe(false);
    expect(seen.others).toBeNull();
    expect(JSON.stringify(seen)).not.toContain("PANEL-SECRET");
    const cmp = await comparison(w.hr, w.req.id);
    const row = cmp.candidates[0].interviews[0];
    expect(row).toMatchObject({ closed: false, panelSize: 3, submitted: 1, scorecards: null, spread: null });
    expect(JSON.stringify(cmp)).not.toContain("PANEL-SECRET");
    await submitScorecard(w.staff[2].ctx, w.interview.id, card(w, [4, 4, 4]));
    await closePanel(w.hr, w.interview.id);
    const after = await getMyScorecard(w.staff[2].ctx, w.interview.id);
    expect(after.closed).toBe(true);
    // member 2 reads the one other scorecard that was submitted (the chair never did)
    expect(after.others!).toHaveLength(1);
    expect(JSON.stringify(after)).toContain("PANEL-SECRET");
  });
  it("is written to the audit log by ids and the outcome, never a comment", async () => {
    const w = await setup();
    await withPanel(w);
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [3, 3, 3], "HIRE", SECRET));
    await submitScorecard(w.staff[2].ctx, w.interview.id, card(w, [3, 3, 3], "HIRE", SECRET));
    await closePanel(w.hr, w.interview.id);
    await recommendSelection(w.staff[0].ctx, w.candidate.id, `Recommend: ${SECRET}`).catch(() => null);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { in: ["CRITERIA_SET", "PANEL_SET", "SCORECARD_SUBMIT", "PANEL_CLOSE", "SELECTION_RECOMMEND"] } } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["CRITERIA_SET", "PANEL_SET", "SCORECARD_SUBMIT", "PANEL_CLOSE"]));
    expect(JSON.stringify(rows)).not.toContain("PANEL-SECRET");
  });
});

describe("closing a panel before everyone has scored", () => {
  it("is done by the chair or by HR, needs at least one scorecard, and not by an ordinary member", async () => {
    const w = await setup();
    await withPanel(w);
    await expect(closePanel(w.hr, w.interview.id)).rejects.toThrow(/at least one/i);
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [3, 3, 3]));
    await expect(closePanel(w.staff[2].ctx, w.interview.id)).rejects.toThrow(/chair|permission/i);
    await expect(closePanel(w.boss, w.interview.id)).rejects.toThrow(/permission|chair/i);
    await closePanel(w.staff[0].ctx, w.interview.id);
    expect((await db.interview.findUniqueOrThrow({ where: { id: w.interview.id } })).completedAt).not.toBeNull();
    await expect(closePanel(w.hr, w.interview.id)).rejects.toThrow(/already closed/i);
  });
});

describe("the comparison", () => {
  async function twoCandidates() {
    const w = await setup();
    await withPanel(w);
    // candidate 1 (the lower number) scores worse than candidate 2
    await submitScorecard(w.staff[0].ctx, w.interview.id, card(w, [2, 2, 2], "NO_HIRE"));
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [1, 2, 3], "NO_HIRE"));
    await submitScorecard(w.staff[2].ctx, w.interview.id, card(w, [3, 2, 1], "HIRE"));
    const c2 = await addCandidate(w.hr, { requisitionId: w.req.id, firstName: "Zainab", lastName: "Second", source: "REFERRAL" });
    const iv2 = await scheduleInterview(w.hr, { candidateId: c2.id, scheduledAt: inDays(3), interviewer: "Panel" });
    await withPanel(w, iv2.id);
    await submitScorecard(w.staff[0].ctx, iv2.id, card(w, [5, 5, 5], "STRONG_HIRE"));
    await submitScorecard(w.staff[1].ctx, iv2.id, card(w, [4, 5, 5], "STRONG_HIRE"));
    await submitScorecard(w.staff[2].ctx, iv2.id, card(w, [5, 4, 4], "HIRE"));
    return { w, c2, iv2 };
  }
  it("puts the candidates side by side with the basis of every figure, and never ranks, reorders or hides anyone", async () => {
    const { w, c2 } = await twoCandidates();
    const cmp = await comparison(w.hr, w.req.id);
    // in the order of the candidate numbers, however they scored: the worse-scored candidate stays first
    expect(cmp.candidates.map((c) => c.candidateId)).toEqual([w.candidate.id, c2.id]);
    expect(Object.keys(cmp.candidates[0]).sort()).toEqual(["candidateId", "candidateNumber", "interviews", "name", "stage"]);
    expect(JSON.stringify(cmp)).not.toMatch(/(rank|ranking|best|winner)/i);
    const first = cmp.candidates[0].interviews[0];
    expect(first.closed).toBe(true);
    expect(first.scorecards).toHaveLength(3);
    expect(first.spread!.criteria[0]).toMatchObject({ name: "Relevant experience", min: 1, max: 3, average: 2, count: 3 });
    expect(first.spread!.recommendations).toMatchObject({ NO_HIRE: 2, HIRE: 1 });
    expect(cmp.note).toMatch(/advice/i);
  });
  it("shows the average to one decimal, half up", async () => {
    const w = await setup();
    await withPanel(w);
    await submitScorecard(w.staff[0].ctx, w.interview.id, card(w, [4, 4, 4]));
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [4, 4, 4]));
    await submitScorecard(w.staff[2].ctx, w.interview.id, card(w, [5, 4, 4]));
    const cmp = await comparison(w.hr, w.req.id);
    // (4 + 4 + 5) / 3 = 4.333...
    expect(cmp.candidates[0].interviews[0].spread!.criteria[0].average).toBe(4.3);
  });
  it("is read by HR for the whole requisition, and by a panel member only for interviews they sat on that are closed", async () => {
    const { w } = await twoCandidates();
    const open = await addCandidate(w.hr, { requisitionId: w.req.id, firstName: "Open", lastName: "Third", source: "OTHER" });
    const ivOpen = await scheduleInterview(w.hr, { candidateId: open.id, scheduledAt: inDays(4), interviewer: "Panel" });
    await setPanel(w.hr, ivOpen.id, { chairEmployeeId: w.staff[3].id, memberEmployeeIds: [w.staff[4].id] });
    // staff[0] sat on the first two (closed) and not on the third
    const mine = await comparison(w.staff[0].ctx, w.req.id);
    expect(mine.candidates).toHaveLength(2);
    expect(mine.candidates.every((c) => c.interviews.every((i) => i.closed))).toBe(true);
    // a member of the open one sees nothing yet, and a person on no panel is refused
    expect((await comparison(w.staff[3].ctx, w.req.id)).candidates).toEqual([]);
    await expect(comparison(w.staff[5].ctx, w.req.id)).rejects.toThrow(/permission/);
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.t.ctx("SUPERVISOR")]) await expect(comparison(ctx, w.req.id), ctx.role).rejects.toThrow(/permission/);
    expect((await comparison(w.hr, w.req.id)).candidates).toHaveLength(3);
  });
  it("is not readable from another company", async () => {
    const { w } = await twoCandidates();
    await expect(comparison((await isolatedOrg()).ctx("HR_ADMIN"), w.req.id)).rejects.toThrow(/not found/i);
  });
});

describe("selecting a candidate: the chair recommends, a second person approves", () => {
  async function closed() {
    const w = await setup();
    await withPanel(w);
    await submitScorecard(w.staff[0].ctx, w.interview.id, card(w, [5, 5, 5], "STRONG_HIRE"));
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [4, 4, 4], "HIRE"));
    await submitScorecard(w.staff[2].ctx, w.interview.id, card(w, [4, 5, 4], "HIRE"));
    return w;
  }
  const offer = (w: W) => createOffer(w.hr, { candidateId: w.candidate.id, jobTitle: "Site Supervisor", monthlyGross: 250000, employmentType: "PERMANENT", startDate: inDays(30), setPayRate: true });

  it("is recommended by the chair of a closed panel alone, with a reason", async () => {
    const w = await closed();
    await moveCandidate(w.hr, w.candidate.id, "OFFER");
    await expect(recommendSelection(w.staff[1].ctx, w.candidate.id, "A member who is not the chair")).rejects.toThrow(/chair/i);
    await expect(recommendSelection(w.hr, w.candidate.id, "HR is not the chair of the panel")).rejects.toThrow(/chair/i);
    await expect(recommendSelection(w.staff[0].ctx, w.candidate.id, "short")).rejects.toThrow(/reason/i);
    await recommendSelection(w.staff[0].ctx, w.candidate.id, "Strongest on reliability and experience");
    await expect(recommendSelection(w.staff[0].ctx, w.candidate.id, "A second recommendation")).rejects.toThrow(/already/i);
  });
  it("is refused while the panel is still open", async () => {
    const w = await setup();
    await withPanel(w);
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [4, 4, 4]));
    await expect(recommendSelection(w.staff[0].ctx, w.candidate.id, "Too early to recommend anyone")).rejects.toThrow(/closed/i);
  });
  it("is approved or declined by someone who holds the approval right and is not the chair, and not twice", async () => {
    const w = await closed();
    await moveCandidate(w.hr, w.candidate.id, "OFFER");
    await recommendSelection(w.staff[0].ctx, w.candidate.id, "Strongest on reliability and experience");
    // the chair holds no approval right and cannot approve their own recommendation
    await expect(decideSelection(w.staff[0].ctx, w.candidate.id, "APPROVED", "Approving my own")).rejects.toThrow(/permission|own/i);
    await expect(decideSelection(w.t.ctx("FINANCE"), w.candidate.id, "APPROVED", "Not mine to approve")).rejects.toThrow(/permission/);
    await expect(decideSelection(w.hr, w.candidate.id, "REJECTED", "no")).rejects.toThrow(/reason/i);
    await decideSelection(w.hr, w.candidate.id, "APPROVED", "Agreed");
    await expect(decideSelection(w.boss, w.candidate.id, "REJECTED", "Changed my mind later")).rejects.toThrow(/already/i);
    expect((await db.candidateSelection.findUniqueOrThrow({ where: { candidateId: w.candidate.id } })).status).toBe("APPROVED");
  });
  it("lets the chair recommend again after a decline", async () => {
    const w = await closed();
    await moveCandidate(w.hr, w.candidate.id, "OFFER");
    await recommendSelection(w.staff[0].ctx, w.candidate.id, "Strongest on reliability and experience");
    await decideSelection(w.hr, w.candidate.id, "REJECTED", "Wait for the second round");
    await recommendSelection(w.staff[0].ctx, w.candidate.id, "Second round done, still the strongest");
    expect((await db.candidateSelection.findUniqueOrThrow({ where: { candidateId: w.candidate.id } })).status).toBe("PENDING");
  });
  it("is needed before an offer for a candidate a panel interviewed, and for no one else", async () => {
    const w = await closed();
    await moveCandidate(w.hr, w.candidate.id, "OFFER");
    await expect(offer(w)).rejects.toThrow(/panel/i);
    await recommendSelection(w.staff[0].ctx, w.candidate.id, "Strongest on reliability and experience");
    await expect(offer(w)).rejects.toThrow(/approve/i);
    await decideSelection(w.hr, w.candidate.id, "APPROVED", "Agreed");
    expect((await offer(w)).offerNumber).toMatch(/^OFR-/);
    // a candidate interviewed the old way (no panel) is unaffected
    const c2 = await addCandidate(w.hr, { requisitionId: w.req.id, firstName: "Old", lastName: "Way", source: "WALK_IN" });
    const iv2 = await scheduleInterview(w.hr, { candidateId: c2.id, scheduledAt: inDays(2), interviewer: "Ada" });
    await recordInterviewFeedback(w.hr, iv2.id, { score: 4, recommendation: "HIRE", feedback: "Solid interview" });
    await moveCandidate(w.hr, c2.id, "OFFER");
    expect((await createOffer(w.hr, { candidateId: c2.id, jobTitle: "Site Supervisor", monthlyGross: 200000, employmentType: "PERMANENT", startDate: inDays(30), setPayRate: true })).offerNumber).toMatch(/^OFR-/);
  });
  it("belongs to the company: another company cannot recommend or decide", async () => {
    const w = await closed();
    await moveCandidate(w.hr, w.candidate.id, "OFFER");
    await recommendSelection(w.staff[0].ctx, w.candidate.id, "Strongest on reliability and experience");
    await expect(decideSelection((await isolatedOrg()).ctx("HR_ADMIN"), w.candidate.id, "APPROVED", "Not their candidate")).rejects.toThrow(/not found/i);
  });
});

describe("who reads interview feedback, and the log of it", () => {
  async function withFeedback() {
    const w = await setup();
    await recordInterviewFeedback(w.hr, w.interview.id, { score: 4, recommendation: "HIRE", feedback: "FEEDBACK-TEXT solid interview" });
    return w;
  }
  it("shows the score, recommendation and words to HR, and records the read", async () => {
    const w = await withFeedback();
    const c = await getCandidate(w.hr, w.candidate.id);
    expect(c!.interviews[0]).toMatchObject({ score: 4, recommendation: "HIRE", feedback: "FEEDBACK-TEXT solid interview" });
    const log = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SENSITIVE_VIEW", entityId: w.candidate.id } });
    expect(log).toHaveLength(1);
    expect((log[0].newValue as { kind: string }).kind).toBe("CANDIDATE_ASSESSMENT");
    expect(JSON.stringify(log)).not.toContain("FEEDBACK-TEXT");
  });
  it("hides the score, recommendation and words from the administrators, finance and the auditor, who still see that interviews took place", async () => {
    const w = await withFeedback();
    for (const role of ["COMPANY_ADMIN", "SUPER_ADMIN", "FINANCE", "AUDITOR"] as const) {
      const c = await getCandidate(w.t.ctx(role), w.candidate.id);
      expect(c!.interviews, role).toHaveLength(1);
      expect(c!.interviews[0], role).toMatchObject({ score: null, recommendation: null, feedback: null });
      expect(JSON.stringify(c), role).not.toContain("FEEDBACK-TEXT");
    }
    // they read no assessment, so no assessment read is logged
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "SENSITIVE_VIEW" } })).toBe(0);
  });
});

describe("an unsuccessful applicant's words", () => {
  it("are cleared with the rest of their details when they are anonymised: scorecard and panel comments, the recommendation note and the decision note", async () => {
    const w = await setup();
    await withPanel(w);
    await submitScorecard(w.staff[0].ctx, w.interview.id, card(w, [5, 5, 5], "STRONG_HIRE", SECRET));
    await submitScorecard(w.staff[1].ctx, w.interview.id, card(w, [4, 4, 4], "HIRE", SECRET));
    await submitScorecard(w.staff[2].ctx, w.interview.id, card(w, [4, 5, 4], "HIRE", SECRET));
    await moveCandidate(w.hr, w.candidate.id, "OFFER");
    await recommendSelection(w.staff[0].ctx, w.candidate.id, `Recommend: ${SECRET}`);
    await decideSelection(w.hr, w.candidate.id, "REJECTED", `Declined: ${SECRET}`);
    await moveCandidate(w.hr, w.candidate.id, "REJECTED", "Another candidate was chosen");
    await db.candidate.update({ where: { id: w.candidate.id }, data: { stageChangedAt: new Date("2020-01-01T00:00:00Z") } });
    const r = await anonymizeStaleCandidates(w.t.org.id, new Date());
    expect(r.anonymized).toBe(1);
    const left = JSON.stringify([
      await db.scorecardScore.findMany({ where: { organizationId: w.t.org.id } }),
      await db.interviewPanelMember.findMany({ where: { organizationId: w.t.org.id } }),
      await db.candidateSelection.findMany({ where: { organizationId: w.t.org.id } }),
    ]);
    expect(left).not.toContain("PANEL-SECRET");
    // the shape stays: the scores, the recommendations and the outcome
    expect(await db.scorecardScore.count({ where: { organizationId: w.t.org.id } })).toBe(9);
    expect((await db.candidateSelection.findUniqueOrThrow({ where: { candidateId: w.candidate.id } })).status).toBe("REJECTED");
  });
});
