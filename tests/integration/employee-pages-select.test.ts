import { describe, expect, it, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { myAppraisals } from "@/server/services/appraisals";
import { myProbationOutcome } from "@/server/services/contracts";
import { myFeedback } from "@/server/services/feedback";
import { myPlans } from "@/server/services/pip";
import { myCases } from "@/server/services/relations";
import { createEmployee } from "@/server/services/employees";
import { isolatedOrg, uid } from "../helpers";

// The employee-facing pages must fetch only the fields they show. A whole row (with a withheld note, a proposed outcome, a reviewer's reasoning or a user id) can end up
// in what the server streams while it renders, even if the page never prints it. These tests look at what is actually asked of the database, not only at what is returned.

afterEach(() => vi.restoreAllMocks());

async function me() {
  const t = await isolatedOrg();
  const hr: Ctx = await (async () => {
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `hr-${uid()}@sel.test`, name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    return { userId: u.id, orgId: t.org.id, role: "HR_ADMIN", name: u.name, email: u.email, employeeId: null };
  })();
  const emp = await createEmployee(hr, { firstName: "Gbenga", lastName: "Selected", employmentDate: "2023-01-05", categoryId: t.guardId });
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `emp-${uid()}@sel.test`, name: "Employee", role: "EMPLOYEE", passwordHash: "x", employeeId: emp.id } });
  const ctx: Ctx = { userId: u.id, orgId: t.org.id, role: "EMPLOYEE", name: u.name, email: u.email, employeeId: emp.id };
  return { t, ctx, emp };
}

/** Every key named anywhere inside the `select` of a Prisma call (and whether the call used `include`, which fetches whole rows). */
function selected(args: unknown): { keys: Set<string>; usesInclude: boolean; hasSelect: boolean } {
  const keys = new Set<string>();
  let usesInclude = false;
  const walk = (node: unknown, inSelect: boolean) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "include") usesInclude = true;
      if (inSelect && v === true) keys.add(k);
      if (k === "select") walk(v, true);
      else if (inSelect) walk(v, true);
      else walk(v, false);
    }
  };
  walk(args, false);
  const a = args as Record<string, unknown>;
  return { keys, usesInclude, hasSelect: !!a && typeof a === "object" && "select" in a };
}

function firstCall(spy: ReturnType<typeof vi.spyOn>) {
  expect(spy).toHaveBeenCalled();
  return selected(spy.mock.calls[0][0]);
}

const never = (keys: Set<string>, forbidden: string[], what: string) => {
  for (const f of forbidden) expect(keys.has(f), `${what} must not fetch ${f}`).toBe(false);
};

describe("the employee's own pages fetch only the fields they show", () => {
  it("My feedback: not the author's user id, and nothing about a void", async () => {
    const w = await me();
    const spy = vi.spyOn(db.performanceFeedback, "findMany");
    await myFeedback(w.ctx);
    const c = firstCall(spy);
    expect(c.hasSelect && !c.usesInclude).toBe(true);
    never(c.keys, ["authorUserId", "voidedAt", "voidedBy", "voidedByUserId", "voidReason"], "My feedback");
    for (const k of ["id", "kind", "body", "relatesOn", "authorName", "employeeReply"]) expect(c.keys.has(k), k).toBe(true);
  });

  it("My cases: not the handler's details or the description, and the resolution is asked for only for a resolved case", async () => {
    const w = await me();
    const spy = vi.spyOn(db.relationsCase, "findMany");
    await myCases(w.ctx);
    const c = firstCall(spy);
    expect(c.hasSelect && !c.usesInclude).toBe(true);
    never(c.keys, ["resolution", "assignedTo", "raisedByUserId", "description", "confidential"], "My cases");
    expect(spy).toHaveBeenCalledTimes(1); // no resolved case, so the resolution is never asked for
  });

  it("My appraisals: not a reviewer's comment, a recommendation, a note or a score that has not been released", async () => {
    const w = await me();
    const spy = vi.spyOn(db.appraisal, "findMany");
    await myAppraisals(w.ctx);
    const c = firstCall(spy);
    expect(c.hasSelect && !c.usesInclude).toBe(true);
    never(c.keys, ["overallScore", "overallBand", "reviewerComment", "recommendation", "returnNote", "approvalNote", "strengths", "improvements", "goals", "criteriaScore", "kpiScore", "reviewerUserId"], "My appraisals");
    expect(spy).toHaveBeenCalledTimes(1); // nothing signed off, so no score is asked for
  });

  it("My improvement plan: not the outcome (until closed), who drafted or approved it, the activation note or a reviewer's note on an objective", async () => {
    const w = await me();
    const spy = vi.spyOn(db.performanceImprovementPlan, "findMany");
    await myPlans(w.ctx);
    const c = firstCall(spy);
    expect(c.hasSelect && !c.usesInclude).toBe(true);
    never(c.keys, ["outcome", "outcomeNote", "draftedBy", "draftedByUserId", "ownerUserId", "activatedBy", "activatedByUserId", "activationNote", "returnNote", "note", "recordedBy", "recordedByUserId"], "My improvement plan");
    expect(spy).toHaveBeenCalledTimes(1); // no closed plan, so the outcome is never asked for
  });

  it("The probation line: the decision and its date, never the reasoning or the appraisal snapshot", async () => {
    const w = await me();
    const spy = vi.spyOn(db.probationDecision, "findFirst");
    await myProbationOutcome(w.ctx);
    const c = firstCall(spy);
    expect(c.hasSelect && !c.usesInclude).toBe(true);
    never(c.keys, ["reason", "decidedBy", "decidedByUserId", "appraisalRecommendation", "appraisalScore", "againstRecommendation", "informedByUserId"], "The probation line");
    for (const k of ["decision", "effectiveDate"]) expect(c.keys.has(k), k).toBe(true);
  });
});
