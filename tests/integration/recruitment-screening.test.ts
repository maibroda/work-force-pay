import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { anonymizeStaleCandidates } from "@/server/services/retention";
import { addCandidate, approveRequisition, createRequisition, moveCandidate } from "@/server/services/recruitment";
import { candidateScreening, decideShortlist, listScreeningCriteria, recordScreening, screeningOverview, setScreeningCriteria } from "@/server/services/recruitment-screening";
import { isolatedOrg } from "../helpers";

// Recruitment slice C: screening criteria and an explained shortlist (the founder's approval of 2026-11-16 of section 5 of docs/plans/recruitment-depth-1a-plan.md, rule 9).
// Criteria are ADVICE: a recorded answer (met, not met or unclear, with the evidence) never ranks, orders, filters or rejects a candidate; shortlisting is a named person's decision with a
// reason. HR (recruitment.assess) alone sets the criteria, records the answers and decides; nothing here changes a candidate's stage.

type T = Awaited<ReturnType<typeof isolatedOrg>>;
const SECRET = "SCREEN-SECRET-EVIDENCE worked two years at the rival firm and was dismissed";

const CRITERIA = [
  { name: "Valid security licence", kind: "MUST_HAVE" as const },
  { name: "Two years' guarding experience", kind: "MUST_HAVE" as const },
  { name: "Speaks Yoruba", kind: "PREFERRED" as const },
];

async function setup() {
  const t: T = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const boss = t.ctx("COMPANY_ADMIN");
  const req = await createRequisition(hr, { title: "Site Guard", categoryId: t.guardId, headcount: 2, employmentType: "PERMANENT", justification: "Two new sites going live" });
  await approveRequisition(boss, req.id);
  const criteria = await setScreeningCriteria(hr, req.id, CRITERIA);
  const first = await addCandidate(hr, { requisitionId: req.id, firstName: "Ada", lastName: "First", source: "REFERRAL" });
  const second = await addCandidate(hr, { requisitionId: req.id, firstName: "Bayo", lastName: "Second", source: "WALK_IN" });
  return { t, hr, boss, req, criteria, first, second };
}
type W = Awaited<ReturnType<typeof setup>>;
const answers = (w: W, outcomes: Array<"MET" | "NOT_MET" | "UNCLEAR">, evidence = "Seen on the licence card and the application form") =>
  w.criteria.map((c, i) => ({ criterionId: c.id, outcome: outcomes[i], evidence: outcomes[i] === "UNCLEAR" ? undefined : evidence }));

describe("who screens", () => {
  it("is the HR administrator alone (the right to assess candidates)", () => {
    expect((Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes("recruitment.assess"))).toEqual(["HR_ADMIN"]);
  });
});

describe("a requisition's screening criteria", () => {
  it("are one to ten, named, each either a must-have or preferred, all different, and set by HR alone", async () => {
    const w = await setup();
    const req2 = await createRequisition(w.hr, { title: "Cleaner", categoryId: w.t.guardId, headcount: 1, employmentType: "PERMANENT", justification: "New site" });
    await approveRequisition(w.boss, req2.id);
    await expect(setScreeningCriteria(w.hr, req2.id, [])).rejects.toThrow(/one to ten/i);
    await expect(setScreeningCriteria(w.hr, req2.id, Array.from({ length: 11 }, (_, i) => ({ name: `Criterion ${i + 1}`, kind: "PREFERRED" as const })))).rejects.toThrow(/one to ten/i);
    await expect(setScreeningCriteria(w.hr, req2.id, [{ name: "Same", kind: "MUST_HAVE" }, { name: "same", kind: "PREFERRED" }])).rejects.toThrow(/different/i);
    await expect(setScreeningCriteria(w.hr, req2.id, [{ name: "ab", kind: "MUST_HAVE" }])).rejects.toThrow();
    await expect(setScreeningCriteria(w.hr, req2.id, [{ name: "Fine name", kind: "OPTIONAL" as never }])).rejects.toThrow();
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.t.ctx("SUPERVISOR"), w.t.ctx("EMPLOYEE")]) await expect(setScreeningCriteria(ctx, req2.id, CRITERIA), ctx.role).rejects.toThrow(/permission/);
    const saved = await setScreeningCriteria(w.hr, req2.id, CRITERIA);
    expect(saved.map((c) => [c.name, c.kind])).toEqual(CRITERIA.map((c) => [c.name, c.kind]));
    expect((await listScreeningCriteria(w.hr, req2.id)).map((c) => c.position)).toEqual([1, 2, 3]);
  });
  it("can be changed until the first answer is recorded, and not after", async () => {
    const w = await setup();
    await setScreeningCriteria(w.hr, w.req.id, [...CRITERIA, { name: "Clean driving licence", kind: "PREFERRED" }]);
    expect(await listScreeningCriteria(w.hr, w.req.id)).toHaveLength(4);
    const crit = await listScreeningCriteria(w.hr, w.req.id);
    await recordScreening(w.hr, w.first.id, crit.map((c) => ({ criterionId: c.id, outcome: "UNCLEAR" as const })));
    await expect(setScreeningCriteria(w.hr, w.req.id, CRITERIA)).rejects.toThrow(/recorded/i);
  });
  it("belong to the company: another company's HR cannot read or set them", async () => {
    const w = await setup();
    const o = await isolatedOrg();
    await expect(listScreeningCriteria(o.ctx("HR_ADMIN"), w.req.id)).rejects.toThrow(/not found/i);
    await expect(setScreeningCriteria(o.ctx("HR_ADMIN"), w.req.id, CRITERIA)).rejects.toThrow(/not found/i);
  });
});

describe("recording the answers for a candidate", () => {
  it("needs an answer for every criterion, each met, not met or unclear, and the evidence for a met or not met", async () => {
    const w = await setup();
    await expect(recordScreening(w.hr, w.first.id, answers(w, ["MET", "MET", "MET"]).slice(0, 2))).rejects.toThrow(/every criterion/i);
    await expect(recordScreening(w.hr, w.first.id, [...answers(w, ["MET", "MET", "MET"]).slice(0, 2), { criterionId: w.criteria[0].id, outcome: "MET", evidence: "Twice the same criterion" }])).rejects.toThrow(/every criterion/i);
    await expect(recordScreening(w.hr, w.first.id, w.criteria.map((c) => ({ criterionId: c.id, outcome: "PERHAPS" as never, evidence: "Something written here" })))).rejects.toThrow();
    await expect(recordScreening(w.hr, w.first.id, w.criteria.map((c, i) => ({ criterionId: c.id, outcome: "MET" as const, evidence: i === 1 ? "" : "Seen on the licence card" })))).rejects.toThrow(/evidence/i);
    await expect(recordScreening(w.hr, w.first.id, w.criteria.map((c, i) => ({ criterionId: c.id, outcome: "NOT_MET" as const, evidence: i === 2 ? "abc" : "No licence was shown" })))).rejects.toThrow(/evidence/i);
    await expect(recordScreening(w.hr, w.first.id, [{ criterionId: "not-a-criterion", outcome: "UNCLEAR" }, ...answers(w, ["UNCLEAR", "UNCLEAR", "UNCLEAR"]).slice(1)])).rejects.toThrow();
    // unclear needs no evidence
    await recordScreening(w.hr, w.first.id, answers(w, ["UNCLEAR", "UNCLEAR", "UNCLEAR"]));
    expect(await db.candidateScreening.count({ where: { candidateId: w.first.id } })).toBe(3);
  });
  it("replaces an earlier answer, records who gave it, and is refused for anyone but HR", async () => {
    const w = await setup();
    await recordScreening(w.hr, w.first.id, answers(w, ["UNCLEAR", "UNCLEAR", "UNCLEAR"]));
    await recordScreening(w.hr, w.first.id, answers(w, ["MET", "NOT_MET", "MET"]));
    const rows = await db.candidateScreening.findMany({ where: { candidateId: w.first.id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.outcome).sort()).toEqual(["MET", "MET", "NOT_MET"]);
    expect(rows.every((r) => r.recordedBy === w.hr.name)).toBe(true);
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.t.ctx("SUPERVISOR")]) await expect(recordScreening(ctx, w.first.id, answers(w, ["MET", "MET", "MET"])), ctx.role).rejects.toThrow(/permission/);
  });
  it("needs criteria first, an open candidate, and a candidate of this company", async () => {
    const w = await setup();
    const req2 = await createRequisition(w.hr, { title: "Driver", categoryId: w.t.guardId, headcount: 1, employmentType: "PERMANENT", justification: "Replace a leaver" });
    await approveRequisition(w.boss, req2.id);
    const c2 = await addCandidate(w.hr, { requisitionId: req2.id, firstName: "No", lastName: "Criteria", source: "OTHER" });
    await expect(recordScreening(w.hr, c2.id, [])).rejects.toThrow(/criteria/i);
    await moveCandidate(w.hr, w.second.id, "REJECTED", "Did not attend");
    await expect(recordScreening(w.hr, w.second.id, answers(w, ["MET", "MET", "MET"]))).rejects.toThrow(/already/i);
    const o = await isolatedOrg();
    await expect(recordScreening(o.ctx("HR_ADMIN"), w.first.id, answers(w, ["MET", "MET", "MET"]))).rejects.toThrow(/not found/i);
  });
});

describe("the shortlist", () => {
  it("is a named person's decision with a reason, after the screening answers are recorded, and by HR alone", async () => {
    const w = await setup();
    await expect(decideShortlist(w.hr, w.first.id, "SHORTLISTED", "Strong on every must-have")).rejects.toThrow(/screening/i);
    await recordScreening(w.hr, w.first.id, answers(w, ["MET", "MET", "UNCLEAR"]));
    await expect(decideShortlist(w.hr, w.first.id, "SHORTLISTED", "short")).rejects.toThrow(/reason/i);
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.t.ctx("SUPERVISOR")]) await expect(decideShortlist(ctx, w.first.id, "SHORTLISTED", "Strong on every must-have"), ctx.role).rejects.toThrow(/permission/);
    await decideShortlist(w.hr, w.first.id, "SHORTLISTED", "Strong on every must-have");
    const row = await db.candidateShortlist.findUniqueOrThrow({ where: { candidateId: w.first.id } });
    expect(row).toMatchObject({ decision: "SHORTLISTED", decidedBy: w.hr.name, decidedById: w.hr.userId });
    // a later decision replaces it
    await decideShortlist(w.hr, w.first.id, "NOT_SHORTLISTED", "The licence has expired");
    expect((await db.candidateShortlist.findUniqueOrThrow({ where: { candidateId: w.first.id } })).decision).toBe("NOT_SHORTLISTED");
  });
  it("can be made for a requisition that has no criteria, with a reason", async () => {
    const w = await setup();
    const req2 = await createRequisition(w.hr, { title: "Driver", categoryId: w.t.guardId, headcount: 1, employmentType: "PERMANENT", justification: "Replace a leaver" });
    await approveRequisition(w.boss, req2.id);
    const c2 = await addCandidate(w.hr, { requisitionId: req2.id, firstName: "Plain", lastName: "Candidate", source: "OTHER" });
    await decideShortlist(w.hr, c2.id, "SHORTLISTED", "Known to the hiring manager already");
    expect((await db.candidateShortlist.findUniqueOrThrow({ where: { candidateId: c2.id } })).decision).toBe("SHORTLISTED");
  });
  it("NEVER moves, rejects or blocks a candidate: a candidate not shortlisted, or who fails a must-have, can still be taken forward by a person", async () => {
    const w = await setup();
    await recordScreening(w.hr, w.first.id, answers(w, ["NOT_MET", "NOT_MET", "NOT_MET"], "Nothing shown at all"));
    await decideShortlist(w.hr, w.first.id, "NOT_SHORTLISTED", "Fails both must-haves on the papers");
    expect((await db.candidate.findUniqueOrThrow({ where: { id: w.first.id } })).stage).toBe("APPLIED");
    await moveCandidate(w.hr, w.first.id, "SCREENING");
    await moveCandidate(w.hr, w.first.id, "INTERVIEW");
    expect((await db.candidate.findUniqueOrThrow({ where: { id: w.first.id } })).stage).toBe("INTERVIEW");
  });
});

describe("the screening overview", () => {
  it("lists every candidate in the order of their candidate numbers, however they answered, with each answer and its evidence", async () => {
    const w = await setup();
    await recordScreening(w.hr, w.first.id, answers(w, ["NOT_MET", "NOT_MET", "NOT_MET"], "Nothing was shown at all"));
    await recordScreening(w.hr, w.second.id, answers(w, ["MET", "MET", "MET"], "Seen and copied for the file"));
    await decideShortlist(w.hr, w.second.id, "SHORTLISTED", "Meets everything asked");
    const o = await screeningOverview(w.hr, w.req.id);
    // the candidate who failed every criterion is still first (lowest candidate number): nothing is ordered by the answers
    expect(o.candidates.map((c) => c.candidateId)).toEqual([w.first.id, w.second.id]);
    expect(o.criteria.map((c) => [c.name, c.kind])).toEqual(CRITERIA.map((c) => [c.name, c.kind]));
    expect(o.candidates[0].summary).toEqual({ met: 0, notMet: 3, unclear: 0, total: 3, mustHaveNotMet: 2 });
    expect(o.candidates[1].summary).toEqual({ met: 3, notMet: 0, unclear: 0, total: 3, mustHaveNotMet: 0 });
    expect(o.candidates[0].answers[0]).toMatchObject({ outcome: "NOT_MET", evidence: "Nothing was shown at all" });
    expect(o.candidates[1].shortlist).toMatchObject({ decision: "SHORTLISTED", reason: "Meets everything asked", decidedBy: w.hr.name });
    expect(o.candidates[0].shortlist).toBeNull();
    expect(Object.keys(o.candidates[0]).sort()).toEqual(["answers", "candidateId", "candidateNumber", "name", "shortlist", "stage", "summary"]);
    expect(JSON.stringify(o)).not.toMatch(/\b(rank|ranking|score|best|winner)\b/i);
    expect(o.note).toMatch(/advice/i);
  });
  it("shows a candidate with no answers yet as not yet screened, and never hides anyone", async () => {
    const w = await setup();
    const o = await screeningOverview(w.hr, w.req.id);
    expect(o.candidates).toHaveLength(2);
    expect(o.candidates.every((c) => c.answers.length === 0 && c.summary.total === 3 && c.summary.met === 0)).toBe(true);
  });
  it("is read by HR alone, is logged when read, and belongs to the company", async () => {
    const w = await setup();
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.t.ctx("SUPERVISOR")]) await expect(screeningOverview(ctx, w.req.id), ctx.role).rejects.toThrow(/permission/);
    await screeningOverview(w.hr, w.req.id);
    const log = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SENSITIVE_VIEW", entityId: w.req.id } });
    expect(log).toHaveLength(1);
    expect((log[0].newValue as { kind: string }).kind).toBe("CANDIDATE_ASSESSMENT");
    await expect(screeningOverview((await isolatedOrg()).ctx("HR_ADMIN"), w.req.id)).rejects.toThrow(/not found/i);
  });
  it("gives one candidate's answers to HR alone, and logs that read", async () => {
    const w = await setup();
    await recordScreening(w.hr, w.first.id, answers(w, ["MET", "UNCLEAR", "MET"]));
    const c = await candidateScreening(w.hr, w.first.id);
    expect(c.answers).toHaveLength(3);
    expect(c.shortlist).toBeNull();
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR")]) await expect(candidateScreening(ctx, w.first.id), ctx.role).rejects.toThrow(/permission/);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "SENSITIVE_VIEW", entityId: w.first.id } })).toBe(1);
  });
});

describe("the audit log", () => {
  it("carries ids and counts, never the evidence or a reason", async () => {
    const w = await setup();
    await recordScreening(w.hr, w.first.id, answers(w, ["MET", "NOT_MET", "MET"], SECRET));
    await decideShortlist(w.hr, w.first.id, "SHORTLISTED", `Shortlisted: ${SECRET}`);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { in: ["SCREENING_CRITERIA_SET", "SCREENING_RECORD", "SHORTLIST_DECIDE"] } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["SCREENING_CRITERIA_SET", "SCREENING_RECORD", "SHORTLIST_DECIDE"]);
    expect(JSON.stringify(rows)).not.toContain("SCREEN-SECRET");
  });
});

describe("an unsuccessful applicant's words", () => {
  it("are cleared with the rest of their details: the evidence and the shortlist reason; the answers and the decision stay", async () => {
    const w = await setup();
    await recordScreening(w.hr, w.first.id, answers(w, ["MET", "NOT_MET", "MET"], SECRET));
    await decideShortlist(w.hr, w.first.id, "NOT_SHORTLISTED", `Not shortlisted: ${SECRET}`);
    await moveCandidate(w.hr, w.first.id, "REJECTED", "Another candidate was chosen");
    await db.candidate.update({ where: { id: w.first.id }, data: { stageChangedAt: new Date("2020-01-01T00:00:00Z") } });
    expect((await anonymizeStaleCandidates(w.t.org.id, new Date())).anonymized).toBe(1);
    const left = JSON.stringify([await db.candidateScreening.findMany({ where: { organizationId: w.t.org.id } }), await db.candidateShortlist.findMany({ where: { organizationId: w.t.org.id } })]);
    expect(left).not.toContain("SCREEN-SECRET");
    expect(await db.candidateScreening.count({ where: { candidateId: w.first.id } })).toBe(3);
    expect((await db.candidateShortlist.findUniqueOrThrow({ where: { candidateId: w.first.id } })).decision).toBe("NOT_SHORTLISTED");
  });
});
