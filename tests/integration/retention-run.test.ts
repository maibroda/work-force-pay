import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { isolatedOrg, uid } from "../helpers";
import { RUNNABLE_CATEGORIES } from "@/lib/retention-run";
import { createEmployee } from "@/server/services/employees";
import { openRequest } from "@/server/services/data-requests";
import { todayUtc } from "@/server/services/hr-policy";
import { confirmRun, listRuns, proposeRun, rejectRun } from "@/server/services/retention-run";
import { dueView, placeHold, releaseHold, updateRule, verifyRule } from "@/server/services/retention-schedule";

// Governance step 3b-2 (docs/plans/hr-governance-step3b2-plan.md): the retention run. HR proposes it for one kind of record; a different person (the Company Administrator) confirms it; confirming
// clears the WORDS of the records past their period and keeps the shape. An unverified rule runs only on a written acceptance; a legal hold always wins. Audit carries ids and counts, never words.

const day = (n: number) => addDays(todayUtc(), n);
const yearsAgo = (n: number) => day(-Math.round(n * 365.25));
const future = (days = 60) => iso(addDays(todayUtc(), days));
const REASON = "A tribunal claim is expected from this person.";
const NOTE = "I have seen the counts and I agree with this run.";
const WRITTEN = "We accept this period as it stands: the lawyer is away until next month.";

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const hr2 = t.ctx("HR_ADMIN", null, 2);
  const boss = t.ctx("COMPANY_ADMIN", null, 3);
  const make = (first: string, last: string) =>
    createEmployee(hr, { firstName: first, lastName: last, gender: "FEMALE", dateOfBirth: "1990-05-05", phone: "08031112222", address: "12 Marina, Lagos", employmentDate: "2010-01-10", categoryId: t.guardId });
  const leaver = async (first: string, last: string, yrs: number) => {
    const e = await make(first, last);
    await db.employee.update({ where: { id: e.id }, data: { status: "RESIGNED", exitDate: yearsAgo(yrs) } });
    return e;
  };
  /** The legal adviser has seen this rule, so a run needs no written acceptance. */
  const verify = (cat: string) => verifyRule(boss, cat, { verifiedBy: "Adaeze Counsel", verifiedOn: iso(todayUtc()), note: "Seen." });
  /** A second active Company Administrator, so the proposer is not the only person who could confirm. */
  const secondBoss = () => db.user.create({ data: { organizationId: t.org.id, email: `boss-${uid()}@run.test`, name: "Second Boss", role: "COMPANY_ADMIN", passwordHash: "x" } });
  /** Lets the minute pass without waiting for it. */
  const ready = (runId: string) => db.retentionRun.update({ where: { id: runId }, data: { proposedAt: new Date(Date.now() - 5 * 60_000) } });
  return { t, hr, hr2, boss, make, leaver, verify, secondBoss, ready };
}
type W = Awaited<ReturnType<typeof world>>;

/** Runs a category end to end: verified, proposed by HR, confirmed by the Company Administrator. */
async function runIt(w: W, category: string) {
  await w.verify(category);
  const run = await proposeRun(w.hr, category);
  await w.ready(run.id);
  return confirmRun(w.boss, run.id, NOTE);
}

// ───────── records with words, one kind at a time ─────────
interface Kind {
  category: (typeof RUNNABLE_CATEGORIES)[number];
  /** One person's (or one case's) records of the kind, with the marker words, when `old` is true past the period and otherwise within it. */
  give: (w: W, employeeId: string, old: boolean) => Promise<void>;
  /** Rows of the kind for that person, as text, so words and shape can be compared. */
  look: (w: W, employeeId: string) => Promise<{ rows: number; text: string }>;
  setup?: (w: W) => Promise<void>;
}
const orgId = (w: W) => w.t.org.id;
const KINDS: Kind[] = [
  {
    category: "APPRAISALS",
    give: async (w, employeeId) => {
      const cycle = await db.appraisalCycle.create({ data: { organizationId: orgId(w), name: `Cycle ${uid()}`, periodStart: day(-3100), periodEnd: day(-3000), dueDate: day(-2990), createdBy: "u1" } });
      await db.appraisal.create({ data: { organizationId: orgId(w), cycleId: cycle.id, employeeId, strengths: "SECRET-APPRAISAL strengths", reviewerComment: "SECRET-APPRAISAL reviewer" } });
    },
    look: async (w, employeeId) => {
      const rows = await db.appraisal.findMany({ where: { organizationId: orgId(w), employeeId } });
      return { rows: rows.length, text: JSON.stringify(rows.map((r) => [r.strengths, r.reviewerComment, r.employeeSelfComment])) };
    },
  },
  {
    category: "PROBATION",
    give: async (w, employeeId) => {
      const contract = await db.employmentContract.create({
        data: { organizationId: orgId(w), contractNumber: `C-${uid()}`, employeeId, type: "PERMANENT", jobTitle: "Guard", startDate: day(-3000), createdBy: "u1", notes: "Joined from the Lagos branch.\nProbation failed: SECRET-PROBATION in the contract" },
      });
      await db.probationDecision.create({ data: { organizationId: orgId(w), employeeId, contractId: contract.id, decision: "CONFIRMED", decidedByUserId: "u1", decidedBy: "Obi", note: "SECRET-PROBATION decision" } });
    },
    look: async (w, employeeId) => {
      const d = await db.probationDecision.findMany({ where: { organizationId: orgId(w), employeeId } });
      const c = await db.employmentContract.findMany({ where: { organizationId: orgId(w), employeeId } });
      return { rows: d.length + c.length, text: JSON.stringify([d.map((x) => x.note), c.map((x) => x.notes)]) };
    },
  },
  {
    category: "FEEDBACK",
    give: async (w, employeeId) => {
      await db.performanceFeedback.create({ data: { organizationId: orgId(w), employeeId, authorUserId: "u1", authorName: "Obi", kind: "RECOGNITION", body: "SECRET-FEEDBACK well done", relatesOn: day(-3000) } });
    },
    look: async (w, employeeId) => {
      const rows = await db.performanceFeedback.findMany({ where: { organizationId: orgId(w), employeeId } });
      return { rows: rows.length, text: JSON.stringify(rows.map((r) => [r.body, r.employeeReply])) };
    },
  },
  {
    category: "IMPROVEMENT_PLANS",
    give: async (w, employeeId) => {
      await db.performanceImprovementPlan.create({
        data: { organizationId: orgId(w), employeeId, concerns: "SECRET-PLAN lateness", startDate: day(-3000), endDate: day(-2900), originalEndDate: day(-2900), ownerUserId: "u1", ownerName: "Obi", draftedByUserId: "u1", draftedBy: "Obi" },
      });
    },
    look: async (w, employeeId) => {
      const rows = await db.performanceImprovementPlan.findMany({ where: { organizationId: orgId(w), employeeId } });
      return { rows: rows.length, text: JSON.stringify(rows.map((r) => [r.concerns, r.outcomeNote])) };
    },
  },
  {
    category: "DISCIPLINARY",
    give: async (w, employeeId) => {
      await db.disciplinaryRecord.create({ data: { organizationId: orgId(w), employeeId, type: "QUERY", incidentDate: day(-3000), description: "SECRET-DISC the incident", remarks: "SECRET-DISC remarks", issuedBy: "HR" } });
    },
    look: async (w, employeeId) => {
      const rows = await db.disciplinaryRecord.findMany({ where: { organizationId: orgId(w), employeeId } });
      return { rows: rows.length, text: JSON.stringify(rows.map((r) => [r.description, r.remarks, r.actionTaken])) };
    },
  },
  {
    category: "TRAINING",
    give: async (w, employeeId) => {
      await db.trainingNeed.create({ data: { organizationId: orgId(w), employeeId, courseName: "First aid", source: "COMPLIANCE", createdBy: "u1", note: "SECRET-TRAIN need" } });
      await db.trainingRequest.create({ data: { organizationId: orgId(w), employeeId, courseName: "Fire safety", reason: "SECRET-TRAIN request", requestedByUserId: "u1", requestedBy: "Obi" } });
    },
    look: async (w, employeeId) => {
      const n = await db.trainingNeed.findMany({ where: { organizationId: orgId(w), employeeId } });
      const r = await db.trainingRequest.findMany({ where: { organizationId: orgId(w), employeeId } });
      return { rows: n.length + r.length, text: JSON.stringify([n.map((x) => x.note), r.map((x) => x.reason)]) };
    },
  },
  {
    category: "SKILLS",
    give: async (w, employeeId) => {
      const skill = await db.skill.create({ data: { organizationId: orgId(w), name: `Skill ${uid()}`, createdBy: "u1" } });
      await db.skillAssessment.create({ data: { organizationId: orgId(w), employeeId, skillId: skill.id, level: 3, assessedOn: day(-3000), assessedByUserId: "u1", assessedBy: "Obi", comment: "SECRET-SKILL comment" } });
    },
    look: async (w, employeeId) => {
      const rows = await db.skillAssessment.findMany({ where: { organizationId: orgId(w), employeeId } });
      return { rows: rows.length, text: JSON.stringify(rows.map((r) => [r.comment, r.level])) };
    },
  },
  {
    category: "WELFARE_CASES",
    // counted per case from the day it was closed: "old" means closed seven years ago
    give: async (w, employeeId, old) => {
      const c = await db.relationsCase.create({
        data: {
          organizationId: orgId(w),
          caseNumber: `W-${uid()}`,
          employeeId,
          type: "WELFARE",
          status: "CLOSED",
          closedAt: old ? yearsAgo(7) : yearsAgo(2),
          summary: "SECRET-WELFARE summary",
          description: "SECRET-WELFARE description",
          resolution: "SECRET-WELFARE resolution",
          raisedBy: "HR",
          raisedByUserId: "u1",
        },
      });
      await db.relationsCaseNote.create({ data: { organizationId: orgId(w), caseId: c.id, note: "SECRET-WELFARE note", authorName: "HR", authorUserId: "u1" } });
    },
    look: async (w, employeeId) => {
      const cases = await db.relationsCase.findMany({ where: { organizationId: orgId(w), employeeId, type: "WELFARE" } });
      const notes = await db.relationsCaseNote.findMany({ where: { caseId: { in: cases.map((c) => c.id) } } });
      return { rows: cases.length + notes.length, text: JSON.stringify([cases.map((c) => [c.summary, c.description, c.resolution]), notes.map((n) => n.note)]) };
    },
  },
  {
    category: "SUCCESSION",
    // reviewed annually by default, so a run needs the rule changed to anonymise; "old" means last reviewed 14 months ago
    setup: async (w) => {
      await updateRule(w.boss, "SUCCESSION", { periodMonths: 12, trigger: "AFTER_RECORD_DATE", action: "ANONYMISE" });
    },
    give: async (w, employeeId, old) => {
      const role = (await db.successionRole.findFirst({ where: { organizationId: orgId(w) } })) ?? (await db.successionRole.create({ data: { organizationId: orgId(w), categoryId: w.t.guardId, createdBy: "u1" } }));
      await db.successionCandidate.create({
        data: { organizationId: orgId(w), roleId: role.id, employeeId, readiness: "READY_NOW", createdBy: "u1", reason: "SECRET-SUCC reason", updatedAt: addDays(todayUtc(), old ? -430 : -90) },
      });
    },
    look: async (w, employeeId) => {
      const rows = await db.successionCandidate.findMany({ where: { organizationId: orgId(w), employeeId } });
      return { rows: rows.length, text: JSON.stringify(rows.map((r) => [r.reason, r.readiness])) };
    },
  },
];
const perPerson = (k: Kind) => k.category !== "WELFARE_CASES" && k.category !== "SUCCESSION";

describe("a confirmed run clears the words and keeps the shape", () => {
  for (const k of KINDS) {
    it(`${k.category}: the words of what is past its period go, the records stay, and nothing else is touched`, async () => {
      const w = await world();
      await k.setup?.(w);
      const old = await w.leaver("Ada", "Okafor", 7); // past the six years
      const within = await w.leaver("Bola", "Adeyemi", 3); // left within the period
      const current = await w.make("Chidi", "Eze"); // still employed
      const recent = await w.make("Dayo", "Bello"); // still employed
      await k.give(w, old.id, true);
      await k.give(w, within.id, false);
      // a per-person kind is counted from the day someone left, so someone still here is never touched; a welfare case or a succession entry is counted per record, so a long-closed case
      // or an entry not reviewed for over a year is cleared even for someone who is still here, and a recent one is not
      await k.give(w, current.id, !perPerson(k));
      await k.give(w, recent.id, false);
      const before = await k.look(w, old.id);
      expect(before.text).toContain("SECRET-");
      const beforeOthers = [await k.look(w, within.id), await k.look(w, recent.id)];
      const beforeCurrent = await k.look(w, current.id);

      const done = await runIt(w, k.category);
      expect(done.status).toBe("EXECUTED");
      expect(done.clearedItems).toBe(perPerson(k) ? 1 : 2);

      const after = await k.look(w, old.id);
      expect(after.rows).toBe(before.rows); // the shape stays
      expect(after.text).not.toContain("SECRET-"); // the words go
      expect(await k.look(w, within.id)).toEqual(beforeOthers[0]);
      expect(await k.look(w, recent.id)).toEqual(beforeOthers[1]);
      const afterCurrent = await k.look(w, current.id);
      expect(afterCurrent.rows).toBe(beforeCurrent.rows);
      if (perPerson(k)) expect(afterCurrent).toEqual(beforeCurrent);
      else expect(afterCurrent.text).not.toContain("SECRET-");
    });
  }

  it("clears only the probation lines of a contract's notes and keeps the rest of the notes", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 7);
    await KINDS.find((k) => k.category === "PROBATION")!.give(w, ada.id, true);
    await runIt(w, "PROBATION");
    const c = await db.employmentContract.findFirstOrThrow({ where: { organizationId: w.t.org.id, employeeId: ada.id } });
    expect(c.notes).toBe("Joined from the Lagos branch.");
  });

  it("leaves the other kinds of record of the same person alone", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 7);
    for (const c of ["DISCIPLINARY", "FEEDBACK"]) await KINDS.find((k) => k.category === c)!.give(w, ada.id, true);
    await runIt(w, "DISCIPLINARY");
    expect((await KINDS.find((k) => k.category === "DISCIPLINARY")!.look(w, ada.id)).text).not.toContain("SECRET-");
    expect((await KINDS.find((k) => k.category === "FEEDBACK")!.look(w, ada.id)).text).toContain("SECRET-FEEDBACK");
  });

  it("never touches another company's records", async () => {
    const a = await world();
    const b = await world();
    const mine = await a.leaver("Ada", "Okafor", 7);
    const theirs = await b.leaver("Efe", "Ojo", 7);
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    await disc.give(a, mine.id, true);
    await disc.give(b, theirs.id, true);
    await runIt(a, "DISCIPLINARY");
    expect((await disc.look(a, mine.id)).text).not.toContain("SECRET-");
    expect((await disc.look(b, theirs.id)).text).toContain("SECRET-DISC");
  });
});

describe("proposing a run", () => {
  it("is for HR administrators only, and a welfare or succession run also needs that function's own right", async () => {
    const w = await world();
    for (const role of ["AUDITOR", "FINANCE", "EMPLOYEE", "SUPERVISOR"] as const) await expect(proposeRun(w.t.ctx(role), "DISCIPLINARY"), role).rejects.toThrow(/permission/i);
    // the Company Administrator holds hr.manage but neither the welfare nor the succession function
    await expect(proposeRun(w.boss, "WELFARE_CASES")).rejects.toThrow(/permission/i);
    await updateRule(w.boss, "SUCCESSION", { periodMonths: 12, trigger: "AFTER_RECORD_DATE", action: "ANONYMISE" });
    await expect(proposeRun(w.boss, "SUCCESSION")).rejects.toThrow(/permission/i);
  });

  it("is refused for a category with no run, a rule that does not say anonymise, and when nothing is due, each with its reason", async () => {
    const w = await world();
    await expect(proposeRun(w.hr, "EMPLOYEE_FILE")).rejects.toThrow(/records retention/i);
    await expect(proposeRun(w.hr, "RAW_SURVEYS")).rejects.toThrow(/by itself|HR policy/i);
    await expect(proposeRun(w.hr, "AUDIT_LOGS")).rejects.toThrow(/never deletes|only reviewed/i);
    await expect(proposeRun(w.hr, "NOT_A_CATEGORY")).rejects.toThrow();
    await expect(proposeRun(w.hr, "SUCCESSION")).rejects.toThrow(/nothing to anonymise/i); // the default says review
    await expect(proposeRun(w.hr, "DISCIPLINARY")).rejects.toThrow(/nothing is due/i);
    await updateRule(w.boss, "FEEDBACK", { periodMonths: 0, trigger: "AFTER_EXIT", action: "KEEP" });
    await expect(proposeRun(w.hr, "FEEDBACK")).rejects.toThrow(/nothing to anonymise/i);
  });

  it("records the counts, the rule as it stood and who proposed, with no name and no words, and changes no record", async () => {
    const w = await world();
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const ada = await w.leaver("Ada", "Okafor", 7);
    const bola = await w.leaver("Bola", "Adeyemi", 8);
    for (const e of [ada, bola]) await disc.give(w, e.id, true);
    const run = await proposeRun(w.hr, "DISCIPLINARY");
    expect(run).toMatchObject({ status: "PROPOSED", category: "DISCIPLINARY", itemCount: 2, skippedHeld: 0, skippedOpen: 0, periodMonths: 72, trigger: "AFTER_EXIT", action: "ANONYMISE", ruleVerified: false, proposedBy: "HR_ADMIN 1" });
    expect(JSON.stringify(run)).not.toMatch(/Okafor|Adeyemi|SECRET/);
    expect((await disc.look(w, ada.id)).text).toContain("SECRET-DISC"); // proposing changes nothing
    expect(await db.retentionRunItem.count({ where: { runId: run.id } })).toBe(2);
  });

  it("is refused while another proposal for the same kind of record is waiting, and allowed again once it is rejected", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 7);
    await KINDS.find((k) => k.category === "DISCIPLINARY")!.give(w, ada.id, true);
    const first = await proposeRun(w.hr, "DISCIPLINARY");
    await expect(proposeRun(w.hr2, "DISCIPLINARY")).rejects.toThrow(/already waiting/i);
    await rejectRun(w.boss, first.id, "Not this month, the lawyer wants to see it first.");
    await expect(proposeRun(w.hr, "DISCIPLINARY")).resolves.toMatchObject({ status: "PROPOSED" });
  });

  it("leaves out the people a legal hold covers and the people with a data request or a case still open, and says how many", async () => {
    const w = await world();
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const [ada, bola, chidi, dayo] = [await w.leaver("Ada", "Okafor", 7), await w.leaver("Bola", "Adeyemi", 7), await w.leaver("Chidi", "Eze", 7), await w.leaver("Dayo", "Bello", 7)];
    for (const e of [ada, bola, chidi, dayo]) await disc.give(w, e.id, true);
    await placeHold(w.hr, { scope: "EMPLOYEE", employeeId: bola.id, reason: REASON, reviewOn: future() });
    await openRequest(w.hr, { employeeId: chidi.id, requesterName: "Chidi Eze", receivedOn: iso(todayUtc()) });
    await db.relationsCase.create({ data: { organizationId: w.t.org.id, caseNumber: `O-${uid()}`, employeeId: dayo.id, type: "GRIEVANCE", status: "OPEN", summary: "x", description: "x", raisedBy: "HR", raisedByUserId: "u1" } });
    const run = await proposeRun(w.hr, "DISCIPLINARY");
    expect(run).toMatchObject({ itemCount: 1, skippedHeld: 1, skippedOpen: 2 });
    const items = await db.retentionRunItem.findMany({ where: { runId: run.id } });
    expect(items.map((i) => i.subjectId)).toEqual([ada.id]);
  });
});

describe("confirming a run", () => {
  async function waiting(w: W, category = "DISCIPLINARY") {
    const ada = await w.leaver("Ada", "Okafor", 7);
    await KINDS.find((k) => k.category === category)!.give(w, ada.id, true);
    return { ada, run: await proposeRun(w.hr, category) };
  }

  it("is for the Company Administrator alone: HR, the auditor and everyone else are refused, and nothing is cleared", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const { ada, run } = await waiting(w);
    await w.ready(run.id);
    for (const ctx of [w.hr, w.hr2, w.t.ctx("AUDITOR"), w.t.ctx("FINANCE"), w.t.ctx("EMPLOYEE")]) await expect(confirmRun(ctx, run.id, NOTE), ctx.role).rejects.toThrow(/permission/i);
    expect((await KINDS.find((k) => k.category === "DISCIPLINARY")!.look(w, ada.id)).text).toContain("SECRET-DISC");
    expect((await db.retentionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("PROPOSED");
  });

  it("cannot be done in the same minute it was proposed", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const { run } = await waiting(w);
    await expect(confirmRun(w.boss, run.id, NOTE)).rejects.toThrow(/Wait \d+ seconds/);
    await w.ready(run.id);
    await expect(confirmRun(w.boss, run.id, NOTE)).resolves.toMatchObject({ status: "EXECUTED" });
  });

  it("needs a note of at least ten characters", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const { run } = await waiting(w);
    await w.ready(run.id);
    await expect(confirmRun(w.boss, run.id, "ok")).rejects.toThrow(/Say why/);
  });

  it("refuses an unverified rule unless the confirmer writes down why they accept it, and flags the run that goes ahead", async () => {
    const w = await world();
    const { ada, run } = await waiting(w);
    await w.ready(run.id);
    await expect(confirmRun(w.boss, run.id, NOTE.slice(0, 14))).rejects.toThrow(/unverified/i);
    expect((await KINDS.find((k) => k.category === "DISCIPLINARY")!.look(w, ada.id)).text).toContain("SECRET-DISC");
    const done = await confirmRun(w.boss, run.id, WRITTEN);
    expect(done).toMatchObject({ status: "EXECUTED", acceptedUnverified: true, singleHolder: false, ruleVerified: false });
    expect(done.decisionNote).toBe(WRITTEN);
  });

  it("lets a verified rule run on a plain note, not flagged as accepted unverified", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const { run } = await waiting(w);
    await w.ready(run.id);
    await w.secondBoss(); // so the proposer is not the only one, and the Company Administrator is a different person from HR anyway
    const done = await confirmRun(w.boss, run.id, "Counts seen, agreed.");
    expect(done).toMatchObject({ status: "EXECUTED", acceptedUnverified: false, singleHolder: false, ruleVerified: true });
  });

  it("refuses a run whose rule changed after it was proposed, because a changed rule is unverified again and what is confirmed must be what was seen", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const { ada, run } = await waiting(w);
    await w.ready(run.id);
    await updateRule(w.boss, "DISCIPLINARY", { periodMonths: 60, trigger: "AFTER_EXIT", action: "ANONYMISE" });
    await expect(confirmRun(w.boss, run.id, WRITTEN)).rejects.toThrow(/changed since/i);
    expect((await KINDS.find((k) => k.category === "DISCIPLINARY")!.look(w, ada.id)).text).toContain("SECRET-DISC");
  });

  it("refuses the person who proposed it while another person could confirm, and lets the only one confirm their own with a written reason, flagged", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const ada = await w.leaver("Ada", "Okafor", 7);
    await KINDS.find((k) => k.category === "DISCIPLINARY")!.give(w, ada.id, true);
    // the Company Administrator both proposes and confirms: allowed only as the single holder
    const run = await proposeRun(w.boss, "DISCIPLINARY");
    await w.ready(run.id);
    const other = await w.secondBoss();
    await expect(confirmRun(w.boss, run.id, WRITTEN)).rejects.toThrow(/different person/i);
    await db.user.update({ where: { id: other.id }, data: { active: false } });
    await expect(confirmRun(w.boss, run.id, "short but ok")).rejects.toThrow(/only person/i);
    const done = await confirmRun(w.boss, run.id, "I am the only administrator here and I checked the counts myself.");
    expect(done).toMatchObject({ status: "EXECUTED", singleHolder: true, acceptedUnverified: false });
  });

  it("cannot be confirmed twice, and a rejected run cannot be confirmed", async () => {
    const w = await world();
    const { run } = await waiting(w);
    await w.verify("DISCIPLINARY");
    await w.ready(run.id);
    await confirmRun(w.boss, run.id, NOTE);
    await expect(confirmRun(w.boss, run.id, NOTE)).rejects.toThrow(/already executed/i);
    const w2 = await world();
    const { run: r2 } = await waiting(w2);
    await rejectRun(w2.boss, r2.id, "Turned down for this month, thanks.");
    await expect(confirmRun(w2.boss, r2.id, NOTE)).rejects.toThrow(/already rejected/i);
  });

  it("cannot be confirmed by another company's administrator", async () => {
    const a = await world();
    const b = await world();
    await a.verify("DISCIPLINARY");
    const { ada, run } = await waiting(a);
    await a.ready(run.id);
    await expect(confirmRun(b.boss, run.id, NOTE)).rejects.toThrow(/not found/i);
    await expect(rejectRun(b.boss, run.id, "Not yours to turn down.")).rejects.toThrow(/not found/i);
    expect((await KINDS.find((k) => k.category === "DISCIPLINARY")!.look(a, ada.id)).text).toContain("SECRET-DISC");
  });
});

describe("what changes between the proposal and the confirmation", () => {
  it("leaves out someone a legal hold now covers, clears the rest, and says how many were left out", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const ada = await w.leaver("Ada", "Okafor", 7);
    const bola = await w.leaver("Bola", "Adeyemi", 7);
    for (const e of [ada, bola]) await disc.give(w, e.id, true);
    const run = await proposeRun(w.hr, "DISCIPLINARY");
    await w.ready(run.id);
    await placeHold(w.hr, { scope: "EMPLOYEE", employeeId: ada.id, reason: REASON, reviewOn: future() });
    const done = await confirmRun(w.boss, run.id, NOTE);
    expect(done).toMatchObject({ status: "EXECUTED", clearedItems: 1, skippedAtConfirm: 1 });
    expect((await disc.look(w, ada.id)).text).toContain("SECRET-DISC");
    expect((await disc.look(w, bola.id)).text).not.toContain("SECRET-");
    const skipped = await db.retentionRunItem.findFirstOrThrow({ where: { runId: run.id, subjectId: ada.id } });
    expect(skipped).toMatchObject({ clearedAt: null, skippedReason: "HOLD" });
  });

  it("leaves out someone who now has a case or a data request open, and someone who has been erased since", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const people = [await w.leaver("Ada", "Okafor", 7), await w.leaver("Bola", "Adeyemi", 7), await w.leaver("Chidi", "Eze", 7), await w.leaver("Dayo", "Bello", 7)];
    for (const e of people) await disc.give(w, e.id, true);
    const run = await proposeRun(w.hr, "DISCIPLINARY");
    await w.ready(run.id);
    await db.relationsCase.create({ data: { organizationId: w.t.org.id, caseNumber: `O-${uid()}`, employeeId: people[0].id, type: "GRIEVANCE", status: "OPEN", summary: "x", description: "x", raisedBy: "HR", raisedByUserId: "u1" } });
    await openRequest(w.hr, { employeeId: people[1].id, requesterName: "Bola Adeyemi", receivedOn: iso(todayUtc()) });
    await db.employee.update({ where: { id: people[2].id }, data: { anonymizedAt: new Date() } });
    const done = await confirmRun(w.boss, run.id, NOTE);
    expect(done).toMatchObject({ clearedItems: 1, skippedAtConfirm: 3 });
    const reasons = Object.fromEntries((await db.retentionRunItem.findMany({ where: { runId: run.id } })).map((i) => [i.subjectId, i.skippedReason]));
    expect(reasons).toMatchObject({ [people[0].id]: "OPEN_CASE", [people[1].id]: "OPEN_DATA_REQUEST", [people[2].id]: "ERASED", [people[3].id]: null });
    expect((await disc.look(w, people[3].id)).text).not.toContain("SECRET-");
    expect((await disc.look(w, people[0].id)).text).toContain("SECRET-DISC");
  });

  it("never runs for a company-wide hold, and runs once it is released", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const ada = await w.leaver("Ada", "Okafor", 7);
    await disc.give(w, ada.id, true);
    const run = await proposeRun(w.hr, "DISCIPLINARY");
    await w.ready(run.id);
    const hold = await placeHold(w.boss, { scope: "COMPANY", reason: REASON, reviewOn: future() });
    const done = await confirmRun(w.boss, run.id, NOTE);
    expect(done).toMatchObject({ clearedItems: 0, skippedAtConfirm: 1 });
    expect((await disc.look(w, ada.id)).text).toContain("SECRET-DISC");
    await releaseHold(w.boss, hold.id, "The matter is closed for the whole company.");
  });
});

describe("the ledger", () => {
  it("takes what a run cleared out of the due count, and a second run finds nothing to do", async () => {
    const w = await world();
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const ada = await w.leaver("Ada", "Okafor", 7);
    const bola = await w.leaver("Bola", "Adeyemi", 8);
    for (const e of [ada, bola]) await disc.give(w, e.id, true);
    const cat = async () => (await dueView(w.hr)).categories.find((c) => c.category === "DISCIPLINARY")!;
    expect(await cat()).toMatchObject({ due: 2 });
    await runIt(w, "DISCIPLINARY");
    expect(await cat()).toMatchObject({ due: 0, soon: 0 });
    await expect(proposeRun(w.hr, "DISCIPLINARY")).rejects.toThrow(/nothing is due/i);
    const items = await db.retentionRunItem.findMany({ where: { organizationId: w.t.org.id } });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.clearedAt !== null && i.skippedReason === null)).toBe(true);
  });

  it("keeps what a hold left out in the due count, so it is picked up once the hold is released", async () => {
    const w = await world();
    await w.verify("DISCIPLINARY");
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const ada = await w.leaver("Ada", "Okafor", 7);
    await disc.give(w, ada.id, true);
    const hold = await placeHold(w.hr, { scope: "EMPLOYEE", employeeId: ada.id, reason: REASON, reviewOn: future() });
    await expect(proposeRun(w.hr, "DISCIPLINARY")).rejects.toThrow(/nothing is due|held/i);
    await releaseHold(w.boss, hold.id, "The claim was withdrawn in writing.");
    const run = await proposeRun(w.hr, "DISCIPLINARY");
    await w.ready(run.id);
    await confirmRun(w.boss, run.id, NOTE);
    expect((await disc.look(w, ada.id)).text).not.toContain("SECRET-");
  });
});

describe("turning a run down", () => {
  it("can be done by the Company Administrator or by the person who proposed it, with a reason, once, and clears nothing", async () => {
    const w = await world();
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const ada = await w.leaver("Ada", "Okafor", 7);
    await disc.give(w, ada.id, true);
    const run = await proposeRun(w.hr, "DISCIPLINARY");
    await expect(rejectRun(w.hr2, run.id, "I am not the one who proposed it.")).rejects.toThrow(/permission/i);
    await expect(rejectRun(w.hr, run.id, "no")).rejects.toThrow(/reason/i);
    await rejectRun(w.hr, run.id, "I proposed it too early, withdrawing it.");
    await expect(rejectRun(w.boss, run.id, "Rejecting a second time over.")).rejects.toThrow(/already rejected/i);
    expect((await db.retentionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("REJECTED");
    expect((await disc.look(w, ada.id)).text).toContain("SECRET-DISC");
    const run2 = await proposeRun(w.hr, "DISCIPLINARY");
    await rejectRun(w.boss, run2.id, "The lawyer has asked for more time.");
  });
});

describe("what is recorded", () => {
  it("audits the proposal, the confirmation and the rejection by ids, counts and flags, never a note or a word", async () => {
    const w = await world();
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const ada = await w.leaver("Ada", "Okafor", 7);
    await disc.give(w, ada.id, true);
    const run = await proposeRun(w.hr, "DISCIPLINARY");
    await w.ready(run.id);
    await confirmRun(w.boss, run.id, "SECRET-NOTE we accept it, the lawyer is away until next month.");
    const w2 = await world();
    const bola = await w2.leaver("Bola", "Adeyemi", 7);
    await disc.give(w2, bola.id, true);
    const r2 = await proposeRun(w2.hr, "DISCIPLINARY");
    await rejectRun(w2.boss, r2.id, "SECRET-REJECT the lawyer wants to see it first.");
    const rows = await db.auditLog.findMany({ where: { organizationId: { in: [w.t.org.id, w2.t.org.id] }, action: { in: ["RETENTION_RUN_PROPOSE", "RETENTION_RUN_EXECUTE", "RETENTION_RUN_REJECT"] } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["RETENTION_RUN_EXECUTE", "RETENTION_RUN_PROPOSE", "RETENTION_RUN_PROPOSE", "RETENTION_RUN_REJECT"]);
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/SECRET/);
    expect(text).not.toMatch(/Okafor|Adeyemi/);
    const exec = rows.find((r) => r.action === "RETENTION_RUN_EXECUTE")!;
    expect(exec.entityId).toBe(run.id);
    expect(JSON.stringify(exec.newValue)).toMatch(/"cleared":1/);
    expect(JSON.stringify(exec.newValue)).toMatch(/acceptedUnverified/);
    // the summary of what was cleared is counts by kind of record
    expect((await db.retentionRun.findUniqueOrThrow({ where: { id: run.id } })).summary).toMatchObject({ disciplinary: 1 });
  });

  it("lists the runs of the company only, with counts and no names, to the people who see HR records", async () => {
    const a = await world();
    const b = await world();
    const disc = KINDS.find((k) => k.category === "DISCIPLINARY")!;
    const ada = await a.leaver("Ada", "Okafor", 7);
    await disc.give(a, ada.id, true);
    const efe = await b.leaver("Efe", "Ojo", 7);
    await disc.give(b, efe.id, true);
    const run = await proposeRun(a.hr, "DISCIPLINARY");
    await proposeRun(b.hr, "DISCIPLINARY");
    const list = await listRuns(a.hr);
    expect(list.runs.map((r) => r.id)).toEqual([run.id]);
    expect(list.runs[0]).toMatchObject({ category: "DISCIPLINARY", status: "PROPOSED", itemCount: 1, label: "Disciplinary records" });
    expect(list.runs[0].waitSeconds).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toMatch(/Okafor|Ojo|SECRET/);
    await expect(listRuns(a.t.ctx("AUDITOR"))).resolves.toBeTruthy();
    await expect(listRuns(a.t.ctx("EMPLOYEE"))).rejects.toThrow(/permission/i);
  });
});

describe("a rule can no longer ask for a deletion the system cannot do", () => {
  it("refuses delete for every kind of record except raw survey answers", async () => {
    const w = await world();
    await expect(updateRule(w.boss, "SKILLS", { periodMonths: 36, trigger: "AFTER_EXIT", action: "DELETE" })).rejects.toThrow(/only raw survey/i);
    await expect(updateRule(w.boss, "RAW_SURVEYS", { periodMonths: 24, trigger: "AFTER_SURVEY_CLOSE", action: "DELETE" })).resolves.toBeUndefined();
  });
});
