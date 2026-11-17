import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { todayUtc } from "@/server/services/hr-policy";
import {
  addCandidate,
  addCheck,
  approveOffer,
  approveRequisition,
  createOffer,
  createRequisition,
  hireCandidate,
  markOfferSent,
  moveCandidate,
  recordInterviewFeedback,
  recordOfferResponse,
  rejectOffer,
  scheduleInterview,
  updateCheck,
  withdrawOffer,
} from "@/server/services/recruitment";
import { isolatedOrg } from "../helpers";

// Follow-up to S7 (docs/plans/internal-selection-plan.md; the founder chose this on 2026-11-17): the audit log carries ids, numbers, stages and statuses, never the words or pay of a person who
// applied. It is read by the administrators and the auditor and it is append-only, so what is written can never be taken back, and erasing a person cannot reach it. Interview feedback in
// particular is read by HR and the panel only, with every read logged: writing it to the audit log bypassed that. The records themselves still hold everything, for the people who may read them.

const inDays = (n: number) => iso(addDays(todayUtc(), n));
const SECRETS = ["SECRET-NOTE", "SECRET-INTERVIEWER", "SECRET-FEEDBACK", "SECRET-CHECK-FINDING", "SECRET-APPROVE", "SECRET-REJECT-OFFER", "SECRET-DECLINE", "SECRET-WITHDRAW", "SECRET-REJECT-CANDIDATE", "876543", "08031234567", "zainab.okafor@example.test", "Zainab", "Okafor"];

async function setup() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const hr2 = t.ctx("HR_ADMIN", null, 2);
  const boss = t.ctx("COMPANY_ADMIN");
  const req = await createRequisition(hr, { title: "Site Supervisor", categoryId: t.guardId, headcount: 5, employmentType: "PERMANENT", justification: "Replace a leaver" } as never);
  await approveRequisition(boss, req.id);
  let seq = 0;
  // the first candidate carries the contact details the test looks for; any other has its own (the app refuses two candidates with the same contact details on one vacancy)
  const candidate = (first = "Zainab", last = "Okafor") => {
    const n = ++seq;
    const own = first === "Zainab";
    return addCandidate(hr, { requisitionId: req.id, firstName: first, lastName: last, phone: own ? "08031234567" : `0809000000${n}`, email: own ? "zainab.okafor@example.test" : `person${n}@example.test`, source: "WALK_IN", notes: "SECRET-NOTE had a difficult exit from a previous employer" } as never);
  };
  /** Through an interview with feedback to the offer stage, then an offer raised. */
  const toOffer = async (c: Awaited<ReturnType<typeof candidate>>) => {
    const iv = await scheduleInterview(hr, { candidateId: c.id, scheduledAt: inDays(2), interviewer: "SECRET-INTERVIEWER Mrs Bello" } as never);
    await recordInterviewFeedback(hr, iv.id, { score: 4, recommendation: "HIRE", feedback: "SECRET-FEEDBACK strong on rota planning but a temper" } as never);
    await moveCandidate(hr, c.id, "OFFER");
    return createOffer(hr, { candidateId: c.id, jobTitle: "Site Supervisor", monthlyGross: 876543, employmentType: "PERMANENT", startDate: inDays(30) } as never);
  };
  const log = () => db.auditLog.findMany({ where: { organizationId: t.org.id, entity: "Candidate" }, orderBy: { createdAt: "asc" } });
  return { t, hr, hr2, boss, req, candidate, toOffer, log };
}

describe("the audit log and the words and pay of a person who applied", () => {
  it("a candidate added, an interview scheduled and its feedback recorded: the log holds ids, numbers and the round, never contact details, notes, the interviewer, the score or a word of feedback", async () => {
    const w = await setup();
    const c = await w.candidate();
    const iv = await scheduleInterview(w.hr, { candidateId: c.id, scheduledAt: inDays(2), interviewer: "SECRET-INTERVIEWER Mrs Bello" } as never);
    await recordInterviewFeedback(w.hr, iv.id, { score: 4, recommendation: "HIRE", feedback: "SECRET-FEEDBACK strong on rota planning but a temper" } as never);
    const rows = await w.log();
    const by = (a: string) => rows.filter((r) => r.action === a);
    expect(by("CANDIDATE_ADD")).toHaveLength(1);
    expect(by("CANDIDATE_ADD")[0].newValue).toMatchObject({ candidateNumber: c.candidateNumber, requisitionId: w.req.id, source: "WALK_IN" });
    expect(by("INTERVIEW_SCHEDULE")[0].newValue).toMatchObject({ interviewId: iv.id, round: 1 });
    expect(by("INTERVIEW_FEEDBACK")[0].newValue).toMatchObject({ interviewId: iv.id, round: 1 });
    const text = JSON.stringify(rows);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(text).not.toMatch(/"score"|"recommendation"|"feedback"|"HIRE"/);
  });

  it("a vetting check is recorded by its type and status, never what it found", async () => {
    const w = await setup();
    const c = await w.candidate();
    const chk = await addCheck(w.hr, { candidateId: c.id, checkType: "POLICE_CLEARANCE" } as never);
    await updateCheck(w.hr, chk.id, "FAILED", "SECRET-CHECK-FINDING a conviction in 2019");
    const rows = (await w.log()).filter((r) => r.action.startsWith("CANDIDATE_CHECK"));
    expect(rows.map((r) => r.action)).toEqual(["CANDIDATE_CHECK_ADD", "CANDIDATE_CHECK_UPDATE"]);
    expect(rows[1].oldValue).toMatchObject({ status: "PENDING" });
    expect(rows[1].newValue).toMatchObject({ checkType: "POLICE_CLEARANCE", status: "FAILED" });
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-CHECK-FINDING|conviction/);
  });

  it("an offer raised, approved, sent and declined is recorded by its number and status, never the pay, the approver's note or the reason for declining", async () => {
    const w = await setup();
    const c = await w.candidate();
    const o = await w.toOffer(c);
    await approveOffer(w.hr2, o.id, "SECRET-APPROVE within the budget for this grade");
    await markOfferSent(w.hr, o.id);
    await recordOfferResponse(w.hr, o.id, "DECLINED", "SECRET-DECLINE took a better-paying job");
    const rows = (await w.log()).filter((r) => r.action.startsWith("OFFER_"));
    expect(rows.map((r) => r.action)).toEqual(["OFFER_RAISE", "OFFER_APPROVE", "OFFER_SEND", "OFFER_DECLINED"]);
    for (const r of rows) expect(r.newValue, r.action).toMatchObject({ offerNumber: o.offerNumber });
    expect(rows[3].newValue).toMatchObject({ status: "DECLINED" });
    expect(rows[3].reason).toBeNull();
    const text = JSON.stringify(rows);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
  });

  it("an offer rejected or withdrawn is recorded the same way, without the reason", async () => {
    const w = await setup();
    const rejected = await w.toOffer(await w.candidate("Ngozi", "Eze"));
    await rejectOffer(w.hr2, rejected.id, "SECRET-REJECT-OFFER the pay is out of line with the grade");
    const withdrawn = await w.toOffer(await w.candidate("Chidi", "Obi"));
    await approveOffer(w.hr2, withdrawn.id);
    await withdrawOffer(w.hr, withdrawn.id, "SECRET-WITHDRAW the candidate was found to have lied");
    const rows = (await w.log()).filter((r) => r.action === "OFFER_REJECT" || r.action === "OFFER_WITHDRAW");
    expect(rows.map((r) => r.action)).toEqual(["OFFER_REJECT", "OFFER_WITHDRAW"]);
    expect(rows[0].newValue).toMatchObject({ offerNumber: rejected.offerNumber, status: "REJECTED" });
    expect(rows[1].newValue).toMatchObject({ offerNumber: withdrawn.offerNumber, status: "WITHDRAWN" });
    for (const r of rows) expect(r.reason, r.action).toBeNull();
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-REJECT-OFFER|SECRET-WITHDRAW|lied/);
  });

  it("rejecting a candidate is recorded as a change of stage, without the reason", async () => {
    const w = await setup();
    const c = await w.candidate();
    await moveCandidate(w.hr, c.id, "REJECTED", "SECRET-REJECT-CANDIDATE rude to the receptionist");
    const row = (await w.log()).find((r) => r.action === "CANDIDATE_STAGE")!;
    expect(row.oldValue).toMatchObject({ stage: "APPLIED" });
    expect(row.newValue).toMatchObject({ stage: "REJECTED" });
    expect(row.reason).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/SECRET-REJECT-CANDIDATE|rude/);
  });

  it("a hire is recorded by the employee, contract and offer numbers, without the offer's pay (decided by the founder on 2026-11-17)", async () => {
    const w = await setup();
    const c = await w.candidate();
    const o = await w.toOffer(c);
    await approveOffer(w.hr2, o.id);
    await markOfferSent(w.hr, o.id);
    await recordOfferResponse(w.hr, o.id, "ACCEPTED");
    const { employee, contract } = await hireCandidate(w.hr, { offerId: o.id });
    const row = (await w.log()).find((r) => r.action === "CANDIDATE_HIRE")!;
    expect(row.newValue).toMatchObject({ employee: employee.employeeNumber, contract: contract.contractNumber, offer: o.offerNumber });
    expect(JSON.stringify(row)).not.toMatch(/monthlyGross|876543/);
  });

  it("the records themselves still hold the words and the pay, for the people who may read them", async () => {
    const w = await setup();
    const c = await w.candidate();
    const o = await w.toOffer(c);
    await approveOffer(w.hr2, o.id, "SECRET-APPROVE within the budget");
    await markOfferSent(w.hr, o.id);
    await recordOfferResponse(w.hr, o.id, "DECLINED", "SECRET-DECLINE took a better job");
    const chk = await addCheck(w.hr, { candidateId: c.id, checkType: "REFERENCE" } as never);
    await updateCheck(w.hr, chk.id, "FAILED", "SECRET-CHECK-FINDING referee unreachable");
    const cand = await db.candidate.findUniqueOrThrow({ where: { id: c.id }, include: { interviews: true, offers: true, checks: true } });
    expect(cand.notes).toContain("SECRET-NOTE");
    expect(cand.phone).toBe("08031234567");
    expect(cand.interviews[0].feedback).toContain("SECRET-FEEDBACK");
    expect(cand.interviews[0].score).toBe(4);
    expect(Number(cand.offers[0].monthlyGross)).toBe(876543);
    expect(cand.offers[0].decisionNote).toContain("SECRET-APPROVE");
    expect(cand.offers[0].declineReason).toContain("SECRET-DECLINE");
    expect(cand.checks[0].notes).toContain("SECRET-CHECK-FINDING");
  });
});
