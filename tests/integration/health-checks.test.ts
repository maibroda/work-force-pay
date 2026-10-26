import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { enableBureau } from "@/server/services/bureau";
import { createLead } from "@/server/services/crm";
import {
  addFinding,
  assessItem,
  createHealthCheck,
  deleteFinding,
  getHealthCheck,
  issueHealthCheck,
  listHealthChecks,
  sendBack,
  submitForReview,
  summaryFile,
  updateHealthCheck,
  withdrawHealthCheck,
} from "@/server/services/health-checks";
import { TEMPLATE, TEMPLATE_VERSION } from "@/lib/health-check";
import { isolatedOrg, uid } from "../helpers";

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@hc.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

async function world() {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  const reviewer = await person(t.org.id, "FINANCE", "reviewer");
  const bd = await person(t.org.id, "BUSINESS_DEV", "sales");
  const hr = await person(t.org.id, "HR_ADMIN", "hr");
  await enableBureau(founder);
  const lead = await createLead(bd, { company: `Guardian ${uid()}${uid()} Ltd`, contactName: "Col. Musa", headcount: 120 } as never);
  return { t, founder, officer, reviewer, bd, hr, lead };
}
type W = Awaited<ReturnType<typeof world>>;
const start = (w: W, as: Ctx = w.officer) => createHealthCheck(as, w.lead.id, { title: "Payroll Health Check", scopeNote: "Walkthrough and a sample of three employees", periodReviewed: "July to September 2026", employeesInScope: 120 });
const items = (id: string) => db.healthCheckItem.findMany({ where: { checkId: id }, orderBy: { position: "asc" } });
const EVIDENCE = "Saw the last two months' input emails from the HR manager";

/** Answers every control as seen in place, except the ones given. */
async function answer(ctx: Ctx, checkId: string, gaps: Record<string, "PARTLY" | "NOT_SEEN" | "NOT_APPLICABLE"> = {}) {
  for (const i of await items(checkId)) {
    const g = gaps[i.code];
    await assessItem(ctx, i.id, g === "NOT_APPLICABLE" ? { response: g, note: "The business has no staff on contract" } : g ? { response: g, evidence: "Asked for it and was shown a spreadsheet only" } : { response: "IN_PLACE", evidence: EVIDENCE });
  }
}
const finding = (itemCode: string, over: Record<string, unknown> = {}) => ({ itemCode, title: `Gap found in ${itemCode}`, description: "Described in the assessor's own words here.", severity: "MEDIUM", recommendation: "Put a second approver in place and keep the record.", ...over }) as never;

describe("starting a check", () => {
  it("numbers it, copies the whole checklist onto it, and attaches it to the lead", async () => {
    const w = await world();
    const c = await start(w);
    expect(c).toMatchObject({ number: "HC-00001", status: "IN_PROGRESS", leadId: w.lead.id, assessedBy: w.officer.name, templateVersion: TEMPLATE_VERSION, employeesInScope: 120 });
    const its = await items(c.id);
    expect(its).toHaveLength(TEMPLATE.length);
    expect(its.every((i) => i.response === "NOT_ASSESSED")).toBe(true);
    expect(its.map((i) => i.code)).toEqual(TEMPLATE.map((t) => t.code));
    expect((await start(w)).number).toBe("HC-00002");
    expect((await listHealthChecks(w.bd, { leadId: w.lead.id })).map((x) => x.number).sort()).toEqual(["HC-00001", "HC-00002"]);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "HEALTH_CHECK_CREATE" } })).toBe(2);
  });

  it("is carried out by staff who may, read by the sales role, and closed to everyone else", async () => {
    const w = await world();
    await expect(start(w, w.bd)).rejects.toThrow(/permission/);
    await expect(start(w, w.hr)).rejects.toThrow(/permission/);
    const c = await start(w, w.reviewer);
    expect((await getHealthCheck(w.bd, c.id)).number).toBe(c.number);
    await expect(getHealthCheck(w.hr, c.id)).rejects.toThrow(/permission/);
    await expect(createHealthCheck(w.officer, "nope", {})).rejects.toThrow(/Lead not found/);
  });

  it("belongs to the bureau's own organization, and stays inside it", async () => {
    const w = await world();
    const plain = await isolatedOrg();
    const admin = await person(plain.org.id, "COMPANY_ADMIN", "plain");
    await expect(listHealthChecks(admin)).rejects.toThrow(/payroll bureau/);
    await expect(listHealthChecks({ ...w.officer, homeOrgId: w.t.org.id })).rejects.toThrow(/own organization/);
    const rival = await world();
    const c = await start(w);
    await expect(getHealthCheck(rival.officer, c.id)).rejects.toThrow(/not found/);
    await expect(createHealthCheck(rival.officer, w.lead.id, {})).rejects.toThrow(/Lead not found/);
  });

  it("won't describe its scope with a promise", async () => {
    const w = await world();
    await expect(createHealthCheck(w.officer, w.lead.id, { scopeNote: "A full review guaranteeing zero errors" })).rejects.toThrow(/promise.*guarantee/);
  });

  it("copies the checklist so it can be answered but never edited, even directly", async () => {
    const w = await world();
    const c = await start(w);
    const [first] = await items(c.id);
    await expect(db.healthCheckItem.update({ where: { id: first.id }, data: { question: "Something easier to pass" } })).rejects.toThrow(/answered, never edited/);
    await expect(db.healthCheckItem.delete({ where: { id: first.id } })).rejects.toThrow(/cannot be removed/);
  });
});

describe("assessing the controls", () => {
  it("needs evidence behind 'seen', a statement of what was shown for 'not seen', and a reason for 'does not apply'", async () => {
    const w = await world();
    const c = await start(w);
    const [a, b, d] = await items(c.id);
    await expect(assessItem(w.officer, a.id, { response: "IN_PLACE" })).rejects.toThrow(/without evidence doesn't count/);
    await expect(assessItem(w.officer, a.id, { response: "PARTLY", evidence: "yes" })).rejects.toThrow(/at least 10/);
    await expect(assessItem(w.officer, b.id, { response: "NOT_SEEN" })).rejects.toThrow(/what you asked for/);
    await expect(assessItem(w.officer, d.id, { response: "NOT_APPLICABLE" })).rejects.toThrow(/why this control doesn't apply/);
    await assessItem(w.officer, a.id, { response: "IN_PLACE", evidence: EVIDENCE });
    await assessItem(w.officer, b.id, { response: "NOT_SEEN", evidence: "Asked twice, none shown" });
    await assessItem(w.officer, d.id, { response: "NOT_APPLICABLE", note: "No casual staff in this business" });
    expect((await items(c.id)).slice(0, 3).map((i) => i.response)).toEqual(["IN_PLACE", "NOT_SEEN", "NOT_APPLICABLE"]);
    expect((await items(c.id))[0].assessedAt).not.toBeNull();
  });

  it("is held to the same rule by the database", async () => {
    const w = await world();
    const c = await start(w);
    const [a] = await items(c.id);
    await expect(db.healthCheckItem.update({ where: { id: a.id }, data: { response: "IN_PLACE" } })).rejects.toThrow();
    await expect(db.healthCheckItem.update({ where: { id: a.id }, data: { response: "NOT_APPLICABLE", note: "no" } })).rejects.toThrow();
  });

  it("can be changed while the check is in progress, and answered again", async () => {
    const w = await world();
    const c = await start(w);
    const [a] = await items(c.id);
    await assessItem(w.officer, a.id, { response: "IN_PLACE", evidence: EVIDENCE });
    await assessItem(w.officer, a.id, { response: "NOT_ASSESSED" });
    const back = (await items(c.id))[0];
    expect(back).toMatchObject({ response: "NOT_ASSESSED", assessedAt: null });
  });
});

describe("findings", () => {
  it("are numbered, tied to a control or an area, and ordered by severity in the summary", async () => {
    const w = await world();
    const c = await start(w);
    const f1 = await addFinding(w.officer, c.id, finding("RC-02", { severity: "HIGH" }));
    const f2 = await addFinding(w.officer, c.id, { area: "STATUTORY", title: "Remittance proofs are kept in several places", description: "Found in three folders and a personal mailbox.", severity: "LOW", recommendation: "Keep one folder per month and file proof there." } as never);
    expect([f1.number, f2.number]).toEqual([1, 2]);
    expect(f1).toMatchObject({ area: "RECORDS", itemCode: "RC-02" });
    expect(f2).toMatchObject({ area: "STATUTORY", itemCode: null });
    await expect(addFinding(w.officer, c.id, finding("ZZ-99"))).rejects.toThrow(/isn't a control/);
    await expect(addFinding(w.officer, c.id, { title: "No area or control given", description: "Described in words here.", severity: "LOW", recommendation: "Say which area it belongs to." } as never)).rejects.toThrow(/which area/);
    await expect(addFinding(w.officer, c.id, finding("IN-01", { title: "A short one" }))).resolves.toMatchObject({ number: 3 });
    expect((await getHealthCheck(w.officer, c.id)).summary.ordered.map((f) => f.number)).toEqual([1, 3, 2]);
  });

  it("can't promise a result, and must say what to do", async () => {
    const w = await world();
    const c = await start(w);
    await expect(addFinding(w.officer, c.id, finding("IN-01", { recommendation: "Do this and we guarantee an error-free payroll" }))).rejects.toThrow(/promise/);
    await expect(addFinding(w.officer, c.id, finding("IN-01", { recommendation: "Fix" }))).rejects.toThrow();
  });

  it("can be removed while in progress, and the numbers stay as they were", async () => {
    const w = await world();
    const c = await start(w);
    const f1 = await addFinding(w.officer, c.id, finding("IN-01"));
    await addFinding(w.officer, c.id, finding("IN-02"));
    await deleteFinding(w.officer, f1.id);
    expect((await addFinding(w.officer, c.id, finding("IN-03"))).number).toBe(3);
  });
});

describe("sending it for review", () => {
  it("says what is left: controls not assessed, and gaps with no finding", async () => {
    const w = await world();
    const c = await start(w);
    await expect(submitForReview(w.officer, c.id)).rejects.toThrow(/25 control\(s\) have not been assessed/);
    await answer(w.officer, c.id, { "RC-02": "NOT_SEEN", "IN-04": "PARTLY" });
    await expect(submitForReview(w.officer, c.id)).rejects.toThrow(/IN-04 is a gap with no finding.*RC-02 is a gap/);
    expect((await getHealthCheck(w.officer, c.id)).blockers).toHaveLength(2);
    await addFinding(w.officer, c.id, finding("RC-02", { severity: "HIGH" }));
    await addFinding(w.officer, c.id, finding("IN-04"));
    await submitForReview(w.officer, c.id);
    const after = await db.healthCheck.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe("IN_REVIEW");
    expect(after.submittedAt).not.toBeNull();
    expect(after.conductedOn).not.toBeNull();
  });

  it("is held to the same rule by the database", async () => {
    const w = await world();
    const c = await start(w);
    await expect(db.healthCheck.update({ where: { id: c.id }, data: { status: "IN_REVIEW", submittedAt: new Date() } })).rejects.toThrow(/have not been assessed/);
    await answer(w.officer, c.id, { "RC-02": "NOT_SEEN" });
    await expect(db.healthCheck.update({ where: { id: c.id }, data: { status: "IN_REVIEW", submittedAt: new Date() } })).rejects.toThrow(/no finding recorded/);
    await expect(db.healthCheck.update({ where: { id: c.id }, data: { status: "ISSUED" } })).rejects.toThrow();
  });

  it("freezes the answers while it is with the reviewer, until it is sent back with a reason", async () => {
    const w = await world();
    const c = await start(w);
    await answer(w.officer, c.id);
    await submitForReview(w.officer, c.id);
    const [a] = await items(c.id);
    await expect(assessItem(w.officer, a.id, { response: "NOT_ASSESSED" })).rejects.toThrow(/with the reviewer/);
    await expect(addFinding(w.officer, c.id, finding("IN-01"))).rejects.toThrow(/with the reviewer/);
    await expect(updateHealthCheck(w.officer, c.id, { title: "Changed title" })).rejects.toThrow(/with the reviewer/);
    await expect(db.healthCheckItem.update({ where: { id: a.id }, data: { note: "sneaky" } })).rejects.toThrow(/only be changed while it is in progress/);
    await expect(sendBack(w.reviewer, c.id, "no")).rejects.toThrow(/at least 5/);
    await sendBack(w.reviewer, c.id, "Please check the evidence for IN-03 again");
    expect(await db.healthCheck.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "IN_PROGRESS", submittedAt: null, reviewNote: "Please check the evidence for IN-03 again" });
    await assessItem(w.officer, a.id, { response: "IN_PLACE", evidence: "Saw the emails again and confirmed the sender" });
  });
});

describe("reviewing and issuing", () => {
  async function ready(w: W) {
    const c = await start(w);
    await answer(w.officer, c.id, { "RC-02": "NOT_SEEN", "ST-03": "NOT_APPLICABLE" });
    await addFinding(w.officer, c.id, finding("RC-02", { severity: "HIGH", title: "Bank detail changes are not approved by a second person" }));
    await submitForReview(w.officer, c.id);
    return c;
  }

  it("is done by someone other than the assessor, who can't issue their own check", async () => {
    const w = await world();
    const c = await ready(w);
    await expect(issueHealthCheck(w.officer, c.id)).rejects.toThrow(/someone else has to review and issue/);
    await expect(db.healthCheck.update({ where: { id: c.id }, data: { status: "ISSUED", reviewedBy: w.officer.name, reviewedByUserId: w.officer.userId, reviewedAt: new Date(), issuedAt: new Date() } })).rejects.toThrow();
    await issueHealthCheck(w.reviewer, c.id, { headline: "Approvals are in place; changes to bank details are not independently approved.", reviewNote: "Evidence for each control checked" });
    expect(await db.healthCheck.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "ISSUED", reviewedBy: w.reviewer.name, reviewNote: "Evidence for each control checked" });
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "HEALTH_CHECK_ISSUE" } })).toBe(1);
  });

  it("can't be issued before it has been submitted, or with an overall observation that promises something", async () => {
    const w = await world();
    const c = await start(w);
    await expect(issueHealthCheck(w.reviewer, c.id)).rejects.toThrow(/sent for review before/);
    const r = await ready(w);
    await expect(issueHealthCheck(w.reviewer, r.id, { headline: "Their payroll is fully compliant and error-free" })).rejects.toThrow(/promise.*error-free/);
  });

  it("is frozen once issued, in the service and in the database, and can't be withdrawn", async () => {
    const w = await world();
    const c = await ready(w);
    await issueHealthCheck(w.reviewer, c.id);
    const [a] = await items(c.id);
    await expect(assessItem(w.officer, a.id, { response: "NOT_ASSESSED" })).rejects.toThrow(/issued and can't change/);
    await expect(addFinding(w.officer, c.id, finding("IN-01"))).rejects.toThrow(/issued and can't change/);
    await expect(withdrawHealthCheck(w.founder, c.id, "Changed our minds about it")).rejects.toThrow(/already issued/);
    await expect(db.healthCheck.update({ where: { id: c.id }, data: { headline: "Rewritten afterwards" } })).rejects.toThrow(/issued or withdrawn/);
    await expect(db.healthCheckItem.update({ where: { id: a.id }, data: { evidence: "Rewritten afterwards" } })).rejects.toThrow(/only be changed while it is in progress/);
    const f = await db.healthCheckFinding.findFirstOrThrow({ where: { checkId: c.id } });
    await expect(db.healthCheckFinding.delete({ where: { id: f.id } })).rejects.toThrow(/only be changed while it is in progress/);
    await expect(db.healthCheck.delete({ where: { id: c.id } })).rejects.toThrow(/never deleted/);
  });

  it("can be withdrawn before issue, with a reason", async () => {
    const w = await world();
    const c = await start(w);
    await expect(withdrawHealthCheck(w.officer, c.id, "no")).rejects.toThrow(/at least 5/);
    await withdrawHealthCheck(w.officer, c.id, "The prospect pulled out of the review");
    expect(await db.healthCheck.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "WITHDRAWN", withdrawnReason: "The prospect pulled out of the review" });
    await expect(assessItem(w.officer, (await items(c.id))[0].id, { response: "NOT_ASSESSED" })).rejects.toThrow(/withdrawn and can't change/);
  });
});

describe("the one-page summary", () => {
  it("is a one-page PDF, stamped as a draft until issued, readable by the sales role, audited each time", async () => {
    const w = await world();
    const c = await start(w);
    await answer(w.officer, c.id, { "RC-02": "NOT_SEEN" });
    await addFinding(w.officer, c.id, finding("RC-02", { severity: "HIGH" }));
    const draft = await summaryFile(w.bd, c.id);
    expect(Buffer.from(draft.bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(draft).toMatchObject({ shown: 1, total: 1 });
    expect(draft.fileName).toMatch(/^HC-00001-health-check-Guardian-.*\.pdf$/);
    await submitForReview(w.officer, c.id);
    await issueHealthCheck(w.reviewer, c.id, { headline: "One control was not seen operating." });
    const final = await summaryFile(w.officer, c.id);
    expect((await PDFDocument.load(final.bytes)).getPageCount()).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "HEALTH_CHECK_SUMMARY_DOWNLOAD", entityId: c.id } })).toBe(2);
    await expect(summaryFile(w.hr, c.id)).rejects.toThrow(/permission/);
  });
});
