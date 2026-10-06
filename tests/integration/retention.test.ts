import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { isolatedOrg } from "../helpers";
import { updateHrPolicy } from "@/server/services/hr-policy";
import { addCandidate, approveRequisition, createRequisition, recordInterviewFeedback, scheduleInterview } from "@/server/services/recruitment";
import { anonymizeStaleCandidates, retentionPreview, runRetentionForAllOrgs, runRetentionNow } from "@/server/services/retention";

type Org = Awaited<ReturnType<typeof isolatedOrg>>;

const daysAgo = (n: number) => addDays(new Date(), -n);

async function openRequisition(t: Org) {
  const req = await createRequisition(t.ctx("HR_ADMIN"), {
    title: "Guard",
    categoryId: t.guardId,
    departmentId: t.deptId,
    headcount: 5,
    employmentType: "PERMANENT",
    justification: "Retention test",
  });
  await approveRequisition(t.ctx("COMPANY_ADMIN"), req.id);
  return req;
}

/** A candidate with contact details, an interview comment and a vetting note, parked at `stage` since `since`. */
async function candidate(t: Org, reqId: string, first: string, stage: "REJECTED" | "WITHDRAWN" | "APPLIED" | "HIRED", since: Date) {
  const hr = t.ctx("HR_ADMIN");
  const c = await addCandidate(hr, {
    requisitionId: reqId,
    firstName: first,
    lastName: "Applicant",
    phone: `080${Math.floor(Math.random() * 1e8)}`,
    email: `${first.toLowerCase()}@mail.test`,
    notes: "Strong on night-shift experience",
    resumeReference: `cv/${first}.pdf`,
  });
  const iv = await scheduleInterview(hr, { candidateId: c.id, scheduledAt: new Date().toISOString(), interviewer: "Ada", mode: "IN_PERSON" });
  await recordInterviewFeedback(hr, iv.id, { score: 2, recommendation: "NO_HIRE", feedback: "Hesitant about night work" });
  await db.candidateCheck.create({ data: { organizationId: t.org.id, candidateId: c.id, checkType: "REFERENCE", notes: "Referee said unreliable" } });
  await db.candidate.update({
    where: { id: c.id },
    data: { stage, stageChangedAt: since, ...(stage === "REJECTED" || stage === "WITHDRAWN" ? { rejectionReason: "Not a fit for the role" } : {}) },
  });
  return c.id;
}

describe("candidate data retention", () => {
  it("removes the personal details of long-gone candidates and keeps the business record", async () => {
    const t = await isolatedOrg();
    const req = await openRequisition(t);
    const old = await candidate(t, req.id, "Oldreject", "REJECTED", daysAgo(800));
    const oldWithdrawn = await candidate(t, req.id, "Oldwithdrew", "WITHDRAWN", daysAgo(900));

    const r = await anonymizeStaleCandidates(t.org.id);
    expect(r.anonymized).toBe(2);

    const c = await db.candidate.findUniqueOrThrow({ where: { id: old }, include: { interviews: true, checks: true } });
    expect(c).toMatchObject({
      firstName: "Anonymised",
      lastName: "Candidate",
      phone: null,
      email: null,
      notes: null,
      resumeReference: null,
      rejectionReason: "[removed]",
      stage: "REJECTED",
      requisitionId: req.id,
    });
    expect(c.anonymizedAt).not.toBeNull();
    expect(c.candidateNumber).toMatch(/^CAN-/); // the reference survives so the funnel still counts
    expect(c.interviews[0]).toMatchObject({ feedback: "[removed]", score: 2, recommendation: "NO_HIRE" });
    expect(c.checks[0].notes).toBeNull();
    expect((await db.candidate.findUniqueOrThrow({ where: { id: oldWithdrawn } })).anonymizedAt).not.toBeNull();

    const log = await db.auditLog.findFirst({ where: { organizationId: t.org.id, action: "CANDIDATE_ANONYMIZE" } });
    expect(log?.userName).toBe("System (data retention)");
  });

  it("leaves recent, active and hired candidates alone", async () => {
    const t = await isolatedOrg();
    const req = await openRequisition(t);
    const recent = await candidate(t, req.id, "Recent", "REJECTED", daysAgo(100));
    const active = await candidate(t, req.id, "Active", "APPLIED", daysAgo(1000)); // still in the pipeline, however long it's sat
    const hired = await candidate(t, req.id, "Hired", "HIRED", daysAgo(1000));

    const r = await anonymizeStaleCandidates(t.org.id);
    expect(r.anonymized).toBe(0);
    for (const [id, first] of [[recent, "Recent"], [active, "Active"], [hired, "Hired"]] as const) {
      const c = await db.candidate.findUniqueOrThrow({ where: { id } });
      expect(c.firstName).toBe(first);
      expect(c.anonymizedAt).toBeNull();
    }
    // …but a recent rejection does become due once enough time has passed
    const later = addDays(new Date(), 24 * 31 + 100);
    expect((await anonymizeStaleCandidates(t.org.id, later)).anonymized).toBe(1);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: active } })).anonymizedAt).toBeNull();
  });

  it("follows the policy period, is switched off by 0, and is idempotent", async () => {
    const t = await isolatedOrg();
    const req = await openRequisition(t);
    const hr = t.ctx("HR_ADMIN");
    const id = await candidate(t, req.id, "Midway", "REJECTED", daysAgo(400)); // ~13 months

    expect((await anonymizeStaleCandidates(t.org.id)).anonymized).toBe(0); // default 24 months
    await updateHrPolicy(hr, { candidateRetentionMonths: 0 });
    const off = await anonymizeStaleCandidates(t.org.id, addDays(new Date(), 5000));
    expect(off.anonymized).toBe(0);
    expect(off.skipped).toMatch(/switched off/);
    expect((await retentionPreview(hr)).due).toBe(0);

    await updateHrPolicy(hr, { candidateRetentionMonths: 12 });
    expect((await retentionPreview(hr)).due).toBe(1);
    expect((await anonymizeStaleCandidates(t.org.id)).anonymized).toBe(1);
    const first = await db.candidate.findUniqueOrThrow({ where: { id } });
    expect(first.firstName).toBe("Anonymised");

    const again = await anonymizeStaleCandidates(t.org.id);
    expect(again.anonymized).toBe(0);
    const second = await db.candidate.findUniqueOrThrow({ where: { id } });
    expect(second.anonymizedAt?.getTime()).toBe(first.anonymizedAt?.getTime()); // not re-stamped
    expect(await retentionPreview(hr)).toMatchObject({ due: 0, alreadyAnonymized: 1 });
  });

  it("validates the policy value", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await expect(updateHrPolicy(hr, { candidateRetentionMonths: -1 })).rejects.toThrow();
    await expect(updateHrPolicy(hr, { candidateRetentionMonths: 121 })).rejects.toThrow();
    expect((await updateHrPolicy(hr, { candidateRetentionMonths: 36 })).candidateRetentionMonths).toBe(36);
  });

  it("only touches the organization it runs for, and run-now needs hr.configure", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const reqA = await openRequisition(a);
    const reqB = await openRequisition(b);
    const inA = await candidate(a, reqA.id, "Alpha", "REJECTED", daysAgo(800));
    const inB = await candidate(b, reqB.id, "Bravo", "REJECTED", daysAgo(800));

    await expect(runRetentionNow(a.ctx("OPERATIONS"))).rejects.toThrow();
    const r = await runRetentionNow(a.ctx("HR_ADMIN"));
    expect(r.anonymized).toBe(1);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: inA } })).anonymizedAt).not.toBeNull();
    expect((await db.candidate.findUniqueOrThrow({ where: { id: inB } })).firstName).toBe("Bravo");

    // the scheduled job covers every organization (the seeded ones simply have nothing due)
    const all = await runRetentionForAllOrgs();
    expect(all.find((x) => x.organization === b.org.name)?.anonymized).toBe(1);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: inB } })).firstName).toBe("Anonymised");
  });
});
