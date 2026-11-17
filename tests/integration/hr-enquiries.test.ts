import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { isolatedOrg } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { getHrPolicy, updateHrPolicy } from "@/server/services/hr-policy";
import { closeEnquiry, enquiriesOverdue, getEnquiry, listEnquiries, moveEnquiryToCase, myEnquiries, raiseEnquiry, replyToEnquiry } from "@/server/services/hr-enquiries";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { compileEmployeeData } from "@/server/services/data-requests";
import { buildHrDigest } from "@/server/services/reminders";
import { sensitiveAccessLog } from "@/server/services/sensitive-access";

// HR enquiries (slice 5A, approved by the founder on 2026-11-17: plan docs/plans/hr-phases-4-5-plan.md, section 6, rules E1 to E6 as recommended). An employee asks HR a question, HR replies in a
// thread, and it is answered and closed. E1 the categories; E2 a question that is really a grievance, harassment, whistleblowing or welfare concern is moved into a case, never answered here;
// E3 only the employee and the HR administrator read it, and every read by HR is logged; E4 a first-response target of three working days (a company setting); E5 cleared with a former employee's
// erasure; E6 an employee never sees anyone else's. No automatic reply, and nothing here touches pay.
// In November 2026: Monday the 16th, Tuesday the 17th, Thursday the 19th, Friday the 20th, Monday the 23rd.

type Org = Awaited<ReturnType<typeof isolatedOrg>>;
const staff = (t: Org, first: string) => createEmployee(t.ctx("HR_ADMIN"), { firstName: first, lastName: "Asker", employmentDate: "2023-01-01", categoryId: t.guardId } as never);
const ask = (over: Record<string, unknown> = {}) => ({ category: "PAY" as const, subject: "Is my November overtime in my payslip", body: "Please tell me whether the overtime I worked is included.", ...over });

async function world() {
  const t = await isolatedOrg();
  const ann = await staff(t, "Ann");
  const bob = await staff(t, "Bob");
  const hr = t.ctx("HR_ADMIN");
  const annCtx = t.ctx("EMPLOYEE", ann.id, 1);
  const bobCtx = t.ctx("EMPLOYEE", bob.id, 2);
  return { t, ann, bob, hr, annCtx, bobCtx };
}
const backdate = (id: string, at: string) => db.hrEnquiry.update({ where: { id }, data: { createdAt: new Date(at) } });

describe("who may ask, and what is asked (E1)", () => {
  it("an employee raises an enquiry: it is waiting for HR, numbered, with their message as the first line of the thread", async () => {
    const { annCtx, ann } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    expect(e).toMatchObject({ status: "OPEN", category: "PAY", employeeId: ann.id, firstResponseAt: null, closedAt: null });
    expect(e.number).toMatch(/^ENQ-\d{5}$/);
    const full = await getEnquiry(annCtx, e.id);
    expect(full.messages).toHaveLength(1);
    expect(full.messages[0]).toMatchObject({ side: "EMPLOYEE", body: "Please tell me whether the overtime I worked is included." });
  });

  it("offers only the approved categories, and wants a real subject and message", async () => {
    const { annCtx } = await world();
    for (const category of ["PAY", "LEAVE", "LETTER", "POLICY", "BENEFITS", "OTHER"] as const) await raiseEnquiry(annCtx, ask({ category }));
    await expect(raiseEnquiry(annCtx, ask({ category: "GRIEVANCE" }))).rejects.toThrow();
    await expect(raiseEnquiry(annCtx, ask({ subject: "Hi" }))).rejects.toThrow(/title|short|characters/i);
    await expect(raiseEnquiry(annCtx, ask({ body: "Help" }))).rejects.toThrow(/message|characters|need/i);
  });

  it("is for an employee with a record: a login not linked to an employee, and the HR administrator, cannot raise one", async () => {
    const { t, hr } = await world();
    await expect(raiseEnquiry(t.ctx("EMPLOYEE", null, 9), ask())).rejects.toThrow(/linked|employee record/i);
    await expect(raiseEnquiry(hr, ask())).rejects.toThrow(/permission/);
  });

  it("numbers run on within a company and start again in another", async () => {
    const { annCtx, bobCtx } = await world();
    const a = await raiseEnquiry(annCtx, ask());
    const b = await raiseEnquiry(bobCtx, ask());
    expect(a.number).toBe("ENQ-00001");
    expect(b.number).toBe("ENQ-00002");
    const other = await world();
    expect((await raiseEnquiry(other.annCtx, ask())).number).toBe("ENQ-00001");
  });
});

describe("who reads an enquiry (E3, E6)", () => {
  it("the employee and the HR administrator, and nobody else: not another employee, a manager, finance, payroll, the auditor or either administrator", async () => {
    const { t, hr, annCtx, bobCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    expect((await getEnquiry(annCtx, e.id)).id).toBe(e.id);
    expect((await getEnquiry(hr, e.id)).id).toBe(e.id);
    const others = [bobCtx, t.ctx("SUPERVISOR", null, 3), t.ctx("FINANCE"), t.ctx("PAYROLL_ADMIN"), t.ctx("AUDITOR"), t.ctx("COMPANY_ADMIN"), t.ctx("SUPER_ADMIN"), t.ctx("HR_OFFICER")];
    for (const c of others) await expect(getEnquiry(c, e.id), c.role).rejects.toThrow(/not found|permission/i);
    for (const c of others.slice(1)) await expect(listEnquiries(c), c.role).rejects.toThrow(/permission/);
  });

  it("an employee sees only their own enquiries, never anyone else's", async () => {
    const { annCtx, bobCtx } = await world();
    const mine = await raiseEnquiry(annCtx, ask({ subject: "ANN-SECRET question about my pay" }));
    await raiseEnquiry(bobCtx, ask({ subject: "BOB-SECRET question about my leave", category: "LEAVE" }));
    expect((await myEnquiries(annCtx)).map((e) => e.id)).toEqual([mine.id]);
    expect(JSON.stringify(await myEnquiries(annCtx))).not.toContain("BOB-SECRET");
    expect(JSON.stringify(await myEnquiries(bobCtx))).not.toContain("ANN-SECRET");
  });

  it("is limited to the company: another company's HR administrator finds nothing", async () => {
    const { annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    const other = await isolatedOrg();
    await expect(getEnquiry(other.ctx("HR_ADMIN"), e.id)).rejects.toThrow(/not found/i);
    expect(await listEnquiries(other.ctx("HR_ADMIN"))).toEqual([]);
  });

  it("holds the right as designed: HR administrator only to answer; an employee or supervisor to ask; neither administrator, finance, payroll or the auditor to answer", () => {
    expect(can("HR_ADMIN", "enquiry.respond")).toBe(true);
    for (const r of ["SUPER_ADMIN", "COMPANY_ADMIN", "FINANCE", "PAYROLL_ADMIN", "AUDITOR", "SUPERVISOR", "EMPLOYEE", "HR_OFFICER", "OPERATIONS"] as const) expect(can(r, "enquiry.respond"), r).toBe(false);
    for (const r of ["EMPLOYEE", "SUPERVISOR"] as const) expect(can(r, "enquiry.raise"), r).toBe(true);
    expect(can("HR_ADMIN", "enquiry.raise")).toBe(false);
  });

  it("every read by HR is logged by the enquiry's own number and never by the employee, once in ten minutes; the employee reading their own, and HR's list, are not", async () => {
    const { t, hr, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    await getEnquiry(annCtx, e.id);
    await listEnquiries(hr);
    const log = () => db.auditLog.findMany({ where: { organizationId: t.org.id, action: "SENSITIVE_VIEW", entity: "HrEnquiry" } });
    expect(await log()).toHaveLength(0);
    await getEnquiry(hr, e.id);
    await getEnquiry(hr, e.id);
    const rows = await log();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: e.id, userId: hr.userId });
    expect((rows[0].newValue as { kind: string }).kind).toBe("HR_ENQUIRY");
    const seen = await sensitiveAccessLog(t.ctx("AUDITOR"), {});
    const entry = seen.entries.find((x) => x.kind === ("HR_ENQUIRY" as never))!;
    expect(entry.reference).toBe(e.number);
    expect(entry.employee).toBeNull();
  });
});

describe("the thread", () => {
  it("HR replies: it is answered and the time of the first reply is kept (only the first)", async () => {
    const { hr, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    await replyToEnquiry(hr, e.id, "Yes, it is in line 3 of your payslip.");
    const a = await db.hrEnquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(a.status).toBe("ANSWERED");
    expect(a.firstResponseAt).not.toBeNull();
    await replyToEnquiry(hr, e.id, "And the rate was the standard one.");
    expect((await db.hrEnquiry.findUniqueOrThrow({ where: { id: e.id } })).firstResponseAt).toEqual(a.firstResponseAt);
  });

  it("the employee can reply again, which puts it back to waiting for HR, or close it; the thread keeps every message in order", async () => {
    const { hr, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    await replyToEnquiry(hr, e.id, "Here is the answer.");
    await replyToEnquiry(annCtx, e.id, "Thank you, one more thing: what about the allowance?");
    expect((await db.hrEnquiry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("OPEN");
    const thread = (await getEnquiry(annCtx, e.id)).messages;
    expect(thread.map((m) => m.side)).toEqual(["EMPLOYEE", "HR", "EMPLOYEE"]);
    await closeEnquiry(annCtx, e.id);
    expect(await db.hrEnquiry.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "CLOSED", closedBy: annCtx.name });
  });

  it("nobody else can reply to, or close, someone's enquiry; HR can close only once it has been answered", async () => {
    const { t, hr, annCtx, bobCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    await expect(replyToEnquiry(bobCtx, e.id, "I am not the one who asked this")).rejects.toThrow(/not found/i);
    await expect(closeEnquiry(bobCtx, e.id)).rejects.toThrow(/not found/i);
    await expect(replyToEnquiry(t.ctx("COMPANY_ADMIN"), e.id, "An administrator is not HR here")).rejects.toThrow(/not found|permission/i);
    await expect(closeEnquiry(hr, e.id)).rejects.toThrow(/reply|answer/i);
    await replyToEnquiry(hr, e.id, "Answered.");
    await closeEnquiry(hr, e.id);
    expect(await db.hrEnquiry.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "CLOSED", closedBy: hr.name });
  });

  it("a closed enquiry takes no more messages and cannot be closed again: raise a new one", async () => {
    const { hr, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    await closeEnquiry(annCtx, e.id);
    await expect(replyToEnquiry(hr, e.id, "Too late to say this")).rejects.toThrow(/closed/i);
    await expect(replyToEnquiry(annCtx, e.id, "Still wanted to add this")).rejects.toThrow(/closed/i);
    await expect(closeEnquiry(annCtx, e.id)).rejects.toThrow(/closed/i);
  });

  it("an empty reply is refused, and there is no automatic reply", async () => {
    const { hr, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    expect((await getEnquiry(annCtx, e.id)).messages).toHaveLength(1);
    await expect(replyToEnquiry(hr, e.id, "  ")).rejects.toThrow(/message|write/i);
  });
});

describe("the first-response target (E4)", () => {
  it("is three working days until the company sets another, within 1 to 30, and existing companies start at three", async () => {
    const { t, hr } = await world();
    expect((await getHrPolicy(t.org.id)).enquiryResponseDays).toBe(3);
    await updateHrPolicy(t.ctx("COMPANY_ADMIN"), { enquiryResponseDays: 5 });
    expect((await getHrPolicy(t.org.id)).enquiryResponseDays).toBe(5);
    for (const bad of [0, 31, 2.5]) await expect(updateHrPolicy(t.ctx("COMPANY_ADMIN"), { enquiryResponseDays: bad }), String(bad)).rejects.toThrow();
    await expect(updateHrPolicy(hr, { enquiryResponseDays: 4 })).resolves.toBeTruthy();
  });

  it("an enquiry is overdue once the due day has passed with no reply (raised Monday 16th: due Thursday 19th, overdue from Friday 20th)", async () => {
    const { t, annCtx, hr } = await world();
    const e = await raiseEnquiry(annCtx, ask());
    await backdate(e.id, "2026-11-16T09:00:00Z");
    expect(await enquiriesOverdue(t.org.id, "2026-11-19")).toEqual([]);
    const late = await enquiriesOverdue(t.org.id, "2026-11-20");
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ id: e.id, number: e.number, category: "PAY", dueDay: "2026-11-19", waitingDays: 4 });
    const row = (await listEnquiries(hr, { today: "2026-11-20" })).find((r) => r.id === e.id)!;
    expect(row).toMatchObject({ overdue: true, dueDay: "2026-11-19" });
    expect((await listEnquiries(hr, { overdue: true, today: "2026-11-20" })).map((r) => r.id)).toEqual([e.id]);
    expect(await listEnquiries(hr, { overdue: true, today: "2026-11-19" })).toEqual([]);
  });

  it("the weekend and a public holiday the company has entered do not count (raised Friday 20th with Monday 23rd a holiday: due Thursday 26th)", async () => {
    const { t, annCtx } = await world();
    await db.publicHoliday.create({ data: { organizationId: t.org.id, date: new Date("2026-11-23T00:00:00Z"), name: "Test holiday", createdBy: "test" } });
    const e = await raiseEnquiry(annCtx, ask());
    await backdate(e.id, "2026-11-20T09:00:00Z");
    expect(await enquiriesOverdue(t.org.id, "2026-11-26")).toEqual([]);
    expect((await enquiriesOverdue(t.org.id, "2026-11-27")).map((x) => x.id)).toEqual([e.id]);
  });

  it("follows the company's own target, and an answered or closed enquiry is never overdue", async () => {
    const { t, hr, annCtx, bobCtx } = await world();
    await updateHrPolicy(hr, { enquiryResponseDays: 1 });
    const open = await raiseEnquiry(annCtx, ask());
    const answered = await raiseEnquiry(bobCtx, ask());
    const closed = await raiseEnquiry(bobCtx, ask({ subject: "Another question about leave" }));
    for (const x of [open, answered, closed]) await backdate(x.id, "2026-11-16T09:00:00Z");
    await replyToEnquiry(hr, answered.id, "Answered.");
    await closeEnquiry(bobCtx, closed.id);
    expect((await enquiriesOverdue(t.org.id, "2026-11-18")).map((x) => x.id)).toEqual([open.id]);
  });

  it("the HR digest lists an overdue enquiry by number, category and wait, with a link, and never the subject, the words or the person's name", async () => {
    const { t, annCtx } = await world();
    expect((await buildHrDigest(t.org.id, new Date("2026-11-20T00:00:00Z"))).sections.map((s) => s.key)).not.toContain("hr-enquiries");
    const e = await raiseEnquiry(annCtx, ask({ subject: "DIGEST-SECRET about my pay", body: "DIGEST-BODY-SECRET please" }));
    await backdate(e.id, "2026-11-16T09:00:00Z");
    const digest = await buildHrDigest(t.org.id, new Date("2026-11-20T00:00:00Z"));
    const sec = digest.sections.find((s) => s.key === "hr-enquiries")!;
    expect(sec.items).toHaveLength(1);
    expect(sec.items[0]).toMatchObject({ path: `/hr/enquiries/${e.id}` });
    expect(sec.items[0].text).toContain(e.number);
    // other sections of the digest (onboarding, records) name staff for their own reasons; this section carries only the number, the category and the wait
    const text = JSON.stringify(sec);
    for (const s of ["DIGEST-SECRET", "DIGEST-BODY-SECRET", "Ann", "Asker"]) expect(text, s).not.toContain(s);
    expect(JSON.stringify(digest)).not.toMatch(/DIGEST-SECRET|DIGEST-BODY-SECRET/);
  });
});

describe("the sensitive route (E2): moved into a case, never answered here", () => {
  const grievance = { type: "GRIEVANCE" as const, severity: "MEDIUM" as const, summary: "Concern raised through an HR enquiry", description: "HR to contact the employee about the concern they raised." };

  it("HR moves it into an Employee relations case through the existing process: the case is opened for that employee, the enquiry is closed and answered, and the conversation is not copied", async () => {
    const { t, hr, ann, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask({ category: "OTHER", subject: "MOVE-SECRET my manager and me", body: "MOVE-BODY-SECRET he shouts at me every day." }));
    const c = await moveEnquiryToCase(hr, e.id, grievance);
    const made = await db.relationsCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(made).toMatchObject({ employeeId: ann.id, type: "GRIEVANCE", organizationId: t.org.id });
    expect(JSON.stringify(made)).not.toMatch(/MOVE-SECRET|MOVE-BODY-SECRET/);
    const after = await db.hrEnquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after).toMatchObject({ status: "CLOSED", movedToCaseId: c.id, closedBy: hr.name });
    expect(after.firstResponseAt).not.toBeNull();
  });

  it("the employee is told it has been moved, in words, without the case number", async () => {
    const { hr, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask({ category: "OTHER" }));
    const c = await moveEnquiryToCase(hr, e.id, { ...grievance, type: "HARASSMENT" });
    const last = (await getEnquiry(annCtx, e.id)).messages.at(-1)!;
    expect(last.side).toBe("HR");
    expect(last.body).toMatch(/Employee relations/i);
    expect(last.body).not.toContain((await db.relationsCase.findUniqueOrThrow({ where: { id: c.id } })).caseNumber);
  });

  it("only these kinds of case, not a disciplinary one; only HR; once; not when closed", async () => {
    const { t, hr, annCtx, bobCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask({ category: "OTHER" }));
    await expect(moveEnquiryToCase(hr, e.id, { ...grievance, type: "MISCONDUCT" as never })).rejects.toThrow();
    await expect(moveEnquiryToCase(annCtx, e.id, grievance)).rejects.toThrow(/permission/);
    await expect(moveEnquiryToCase(t.ctx("COMPANY_ADMIN"), e.id, grievance)).rejects.toThrow(/permission/);
    expect(await db.relationsCase.count({ where: { organizationId: t.org.id } })).toBe(0);
    await moveEnquiryToCase(hr, e.id, grievance);
    expect(await db.relationsCase.count({ where: { organizationId: t.org.id } })).toBe(1);
    await expect(moveEnquiryToCase(hr, e.id, grievance)).rejects.toThrow(/already|closed/i);
    expect(await db.relationsCase.count({ where: { organizationId: t.org.id } })).toBe(1);
    const closed = await raiseEnquiry(bobCtx, ask());
    await closeEnquiry(bobCtx, closed.id);
    await expect(moveEnquiryToCase(hr, closed.id, grievance)).rejects.toThrow(/closed/i);
  });

  it("a case that cannot be raised leaves the enquiry exactly as it was", async () => {
    const { hr, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask({ category: "OTHER" }));
    await expect(moveEnquiryToCase(hr, e.id, { ...grievance, summary: "x" })).rejects.toThrow();
    expect(await db.hrEnquiry.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "OPEN", movedToCaseId: null, closedAt: null });
  });
});

describe("privacy: the audit log, erasure and the person's own copy (E5)", () => {
  it("the audit log carries ids, numbers and categories, never a subject or a word of the conversation", async () => {
    const { t, hr, annCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask({ subject: "AUDIT-SECRET my salary", body: "AUDIT-BODY-SECRET what is my basic pay" }));
    await replyToEnquiry(hr, e.id, "AUDIT-REPLY-SECRET it is what the contract says");
    await replyToEnquiry(annCtx, e.id, "AUDIT-FOLLOW-SECRET thanks");
    await closeEnquiry(annCtx, e.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: t.org.id, entity: "HrEnquiry" } });
    expect(rows.map((r) => r.action).sort()).toEqual(["HR_ENQUIRY_CLOSE", "HR_ENQUIRY_EMPLOYEE_REPLY", "HR_ENQUIRY_HR_REPLY", "HR_ENQUIRY_RAISE"]);
    const text = JSON.stringify(rows);
    for (const s of ["AUDIT-SECRET", "AUDIT-BODY-SECRET", "AUDIT-REPLY-SECRET", "AUDIT-FOLLOW-SECRET", "salary"]) expect(text, s).not.toContain(s);
    expect(text).toContain(e.number);
  });

  it("erasing an employee removes the subject and every message, keeps the shape and the audit log, and touches no one else's", async () => {
    const { t, hr, ann, bob, annCtx, bobCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask({ subject: "ERASE-SECRET about my pay" }));
    await replyToEnquiry(hr, e.id, "ERASE-REPLY-SECRET here you are");
    const other = await raiseEnquiry(bobCtx, ask({ subject: "OTHER-STAYS question about leave", category: "LEAVE" }));
    const auditBefore = await db.auditLog.count({ where: { organizationId: t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, t.org.id, ann.id, new Date()));
    expect(counts.hrEnquiries).toBe(1);
    expect(counts.hrEnquiryMessages).toBe(2);
    const text = JSON.stringify([await db.hrEnquiry.findMany({ where: { employeeId: ann.id } }), await db.hrEnquiryMessage.findMany({ where: { enquiryId: e.id } })]);
    for (const s of ["ERASE-SECRET", "ERASE-REPLY-SECRET", "Please tell me whether"]) expect(text, s).not.toContain(s);
    expect(await db.hrEnquiry.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ category: "PAY", status: "ANSWERED" }); // the shape stays
    expect((await db.hrEnquiry.findUniqueOrThrow({ where: { id: other.id } })).subject).toContain("OTHER-STAYS");
    expect((await db.hrEnquiryMessage.findFirstOrThrow({ where: { enquiryId: other.id } })).body).toContain("Please tell me");
    expect(await db.auditLog.count({ where: { organizationId: t.org.id } })).toBe(auditBefore);
    expect(bob.id).not.toBe(ann.id);
  });

  it("the person's own data copy holds their enquiries and the replies, and no one else's", async () => {
    const { t, hr, ann, annCtx, bobCtx } = await world();
    const e = await raiseEnquiry(annCtx, ask({ subject: "COPY-SECRET about my pay" }));
    await replyToEnquiry(hr, e.id, "COPY-REPLY here you are");
    await raiseEnquiry(bobCtx, ask({ subject: "BOB-COPY-SECRET about leave", category: "LEAVE" }));
    const data = await compileEmployeeData(t.org.id, ann.id);
    const section = data.sections.hrEnquiries;
    expect(section.records).toHaveLength(1);
    const text = JSON.stringify(section.records);
    expect(text).toContain("COPY-SECRET");
    expect(text).toContain("COPY-REPLY");
    expect(text).not.toContain("BOB-COPY-SECRET");
  });
});
