import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isolatedOrg } from "../helpers";
import { ensureDefaultChart } from "@/server/services/accounting";
import { periodFor, transitionPeriod } from "@/server/services/periods";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";
import { approveDocument, postDocument, setApprovalRequired } from "@/server/services/journals";
import { deleteTemplate, generateDue, generateDueForAllOrgs, getTemplate, listTemplates, runDueNow, saveTemplate, setTemplateActive } from "@/server/services/recurring-journals";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

async function world() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const prep = t.ctx("FINANCE", null, 1);
  const prep2 = t.ctx("FINANCE", null, 2);
  const boss = t.ctx("COMPANY_ADMIN", null, 1);
  const boss2 = t.ctx("COMPANY_ADMIN", null, 2);
  const hr = t.ctx("HR_ADMIN", null, 1);
  const acct = async (code: string) => (await db.glAccount.findUniqueOrThrow({ where: { organizationId_code: { organizationId: t.org.id, code } } })).id;
  const [cash, expense, accrued, receivable] = await Promise.all([acct("1230"), acct("5400"), acct("2130"), acct("1200")]);
  const template = (over: Record<string, unknown> = {}, ctx = prep) =>
    saveTemplate(ctx, null, {
      name: "Insurance amortisation",
      kind: "MANUAL",
      description: "Insurance for {month}",
      frequency: "MONTHLY",
      monthEnd: true,
      startDate: "2026-08-31",
      lines: [{ accountId: expense, debit: 5000, credit: 0 }, { accountId: cash, debit: 0, credit: 5000 }],
      ...over,
    } as never);
  const docsOf = (templateId: string) => db.journalDocument.findMany({ where: { recurringJournalId: templateId }, orderBy: { postingDate: "asc" }, include: { lines: true } });
  return { t, prep, prep2, boss, boss2, hr, cash, expense, accrued, receivable, template, docsOf };
}

describe("saving a template", () => {
  it("is checked like a journal: balanced, real accounts, no control accounts, a month-end first date", async () => {
    const { prep, hr, cash, expense, receivable, template } = await world();
    await expect(template({ lines: [{ accountId: expense, debit: 5000, credit: 0 }, { accountId: cash, debit: 0, credit: 4000 }] })).rejects.toThrow(/doesn't balance/);
    await expect(template({ lines: [{ accountId: expense, debit: 5000, credit: 0 }, { accountId: "nope", debit: 0, credit: 5000 }] })).rejects.toThrow(/doesn't exist/);
    await expect(template({ lines: [{ accountId: expense, debit: 5000, credit: 0 }, { accountId: receivable, debit: 0, credit: 5000 }] })).rejects.toThrow(/control account/);
    await expect(template({ startDate: "2026-08-30" })).rejects.toThrow(/month end/);
    await expect(template({ kind: "ACCRUAL" })).rejects.toThrow(/days after which it reverses/);
    await expect(template({}, hr)).rejects.toThrow(/permission/i);
    const ok = await template();
    expect(iso(ok.nextRunDate)).toBe("2026-08-31");
    expect(ok.generatedCount).toBe(0);
    expect((await listTemplates(prep)).map((x) => x.name)).toEqual(["Insurance amortisation"]);
  });
});

describe("generating", () => {
  it("makes a draft for each date that has come, catching up oldest first, and not before they are due", async () => {
    const { t, prep, template, docsOf } = await world();
    const tpl = await template();
    const early = await generateDue(prep, day("2026-08-30"));
    expect(early.generated).toBe(0);
    const r = await generateDue(prep, day("2026-10-10"));
    expect(r).toMatchObject({ templates: 1, generated: 2, submitted: 0 });
    const docs = await docsOf(tpl.id);
    expect(docs.map((x) => iso(x.postingDate))).toEqual(["2026-08-31", "2026-09-30"]);
    expect(docs.map((x) => x.description)).toEqual(["Insurance for August 2026", "Insurance for September 2026"]);
    expect(docs.every((x) => x.status === "DRAFT" && x.lines.length === 2)).toBe(true);
    expect(docs.map((x) => x.documentNumber)).toEqual(["MJ-000001", "MJ-000002"]);
    const after = await db.recurringJournal.findUniqueOrThrow({ where: { id: tpl.id } });
    expect(after.generatedCount).toBe(2);
    expect(iso(after.nextRunDate)).toBe("2026-10-31");
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(0); // drafts reach no ledger
  });

  it("never doubles up, however many times it runs", async () => {
    const { prep, template, docsOf } = await world();
    const tpl = await template();
    await generateDue(prep, day("2026-09-30"));
    await generateDue(prep, day("2026-09-30"));
    await Promise.all([generateDue(prep, day("2026-09-30")), generateDue(prep, day("2026-09-30"))]);
    expect(await docsOf(tpl.id)).toHaveLength(2);
    // and the database itself refuses a second journal for the same template and date
    await expect(db.journalDocument.create({ data: { organizationId: tpl.organizationId, documentNumber: "DUP-1", description: "dup", postingDate: day("2026-08-31"), createdBy: "x", createdByUserId: "x", recurringJournalId: tpl.id } })).rejects.toThrow();
  });

  it("stops at the end date, and when a long idle spell would flood the drafts", async () => {
    const { prep, template, docsOf } = await world();
    const ending = await template({ endDate: "2026-10-31" });
    await generateDue(prep, day("2027-12-31"));
    expect((await docsOf(ending.id)).map((x) => iso(x.postingDate))).toEqual(["2026-08-31", "2026-09-30", "2026-10-31"]);
    expect((await db.recurringJournal.findUniqueOrThrow({ where: { id: ending.id } })).nextRunDate).toBeNull();

    const forever = await template({ name: "Old standing charge", startDate: "2020-01-31" });
    const r = await generateDue(prep, day("2026-10-10"));
    expect(r.generated).toBe(24); // the cap; the next run continues from there
    expect(iso((await db.recurringJournal.findUniqueOrThrow({ where: { id: forever.id } })).nextRunDate)).toBe("2022-01-31");
  });

  it("skips a paused template and catches up when it is resumed, under the person who resumed it", async () => {
    const { prep, prep2, template, docsOf } = await world();
    const tpl = await template();
    await setTemplateActive(prep, tpl.id, false);
    expect((await generateDue(prep, day("2026-10-10"))).templates).toBe(0);
    await setTemplateActive(prep2, tpl.id, true);
    await generateDue(prep, day("2026-10-10"));
    const docs = await docsOf(tpl.id);
    expect(docs).toHaveLength(2);
    expect(docs.every((x) => x.createdByUserId === prep2.userId)).toBe(true);
  });

  it("gives an accrual its reversal date, and keeps dimensions on the lines", async () => {
    const { t, prep, expense, accrued, template, docsOf } = await world();
    const cc = await db.costCenter.create({ data: { organizationId: t.org.id, code: "CC1", name: "Lagos" } });
    const tpl = await template({
      kind: "ACCRUAL",
      reverseAfterDays: 1,
      lines: [{ accountId: expense, debit: 800, credit: 0, dimensions: { costCenterId: cc.id } }, { accountId: accrued, debit: 0, credit: 800 }],
    });
    await generateDue(prep, day("2026-08-31"));
    const [doc] = await docsOf(tpl.id);
    expect(doc.kind).toBe("ACCRUAL");
    expect(iso(doc.reverseOn)).toBe("2026-09-01");
    expect(doc.lines.find((l) => Number(l.debit) === 800)?.dimensions).toEqual({ costCenterId: cc.id });
  });
});

describe("submitting automatically", () => {
  it("submits each draft in the preparer's name, so the preparer can't approve it, and someone else can", async () => {
    const { t, prep2, boss, boss2, template, docsOf } = await world();
    const tpl = await template({ autoSubmit: true }, boss); // an administrator can both prepare and approve, which makes the point
    const r = await generateDue(prep2, day("2026-08-31"));
    expect(r).toMatchObject({ generated: 1, submitted: 1, notes: [] });
    const [doc] = await docsOf(tpl.id);
    expect(doc.status).toBe("SUBMITTED");
    expect(doc.createdByUserId).toBe(boss.userId);
    expect(doc.submittedByUserId).toBe(boss.userId);
    await expect(approveDocument(boss, doc.id)).rejects.toThrow(/someone else has to approve/);
    await approveDocument(boss2, doc.id);
    const journal = await postDocument(boss2, doc.id);
    expect(journal.entryNumber).toBeTruthy();
    expect((await checkLedgerIntegrity(t.org.id)).findings).toEqual([]);
  });

  it("leaves a draft it can't submit, says why on the template, and carries on with the next", async () => {
    const { t, prep, boss, template, docsOf } = await world();
    const tpl = await template({ autoSubmit: true });
    const aug = await periodFor(db, t.org.id, day("2026-08-31"));
    await transitionPeriod(prep, aug.id, "SOFT_CLOSE");
    await transitionPeriod(boss, aug.id, "CLOSE");
    const r = await generateDue(prep, day("2026-09-30"));
    expect(r).toMatchObject({ generated: 2, submitted: 1 });
    expect(r.notes.join(" ")).toMatch(/Insurance amortisation: MJ-000001 \(2026-08-31\) was left as a draft — .*Aug 2026 is closed/);
    expect((await docsOf(tpl.id)).map((x) => x.status)).toEqual(["DRAFT", "SUBMITTED"]);
    expect((await db.recurringJournal.findUniqueOrThrow({ where: { id: tpl.id } })).lastRunNote).toMatch(/Aug 2026 is closed/);
  });

  it("never posts unattended: with approval switched off the draft is left for a person", async () => {
    const { t, prep, boss, template, docsOf } = await world();
    await setApprovalRequired(boss, false);
    const tpl = await template({ autoSubmit: true });
    const r = await generateDue(prep, day("2026-08-31"));
    expect(r).toMatchObject({ generated: 1, submitted: 0 });
    expect(r.notes.join(" ")).toMatch(/approval is switched off/);
    expect((await docsOf(tpl.id))[0].status).toBe("DRAFT");
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(0);
  });
});

describe("changing a template", () => {
  it("can change its lines, end date and name, but not its schedule once journals exist", async () => {
    const { prep, prep2, cash, expense, template, docsOf } = await world();
    const tpl = await template();
    await generateDue(prep, day("2026-08-31"));
    await expect(saveTemplate(prep, tpl.id, { name: "x", description: "y" } as never)).rejects.toThrow();
    const same = {
      name: "Insurance, revised",
      kind: "MANUAL",
      description: "Insurance for {month}",
      frequency: "MONTHLY",
      monthEnd: true,
      startDate: "2026-08-31",
      lines: [{ accountId: expense, debit: 6000, credit: 0 }, { accountId: cash, debit: 0, credit: 6000 }],
    };
    await expect(saveTemplate(prep, tpl.id, { ...same, frequency: "QUARTERLY" } as never)).rejects.toThrow(/schedule can't change/);
    await expect(saveTemplate(prep, tpl.id, { ...same, startDate: "2026-07-31" } as never)).rejects.toThrow(/schedule can't change/);
    await saveTemplate(prep2, tpl.id, { ...same, endDate: "2026-09-30" } as never);
    await generateDue(prep, day("2026-12-31"));
    const docs = await docsOf(tpl.id);
    expect(docs.map((x) => iso(x.postingDate))).toEqual(["2026-08-31", "2026-09-30"]);
    expect(Number(docs[0].lines[0].debit)).toBe(5000); // already generated: untouched
    expect(Number(docs[1].lines[0].debit)).toBe(6000);
    expect(docs[1].createdByUserId).toBe(prep2.userId); // the last person to change it is the preparer
    expect((await getTemplate(prep, tpl.id))!.documents).toHaveLength(2);
  });

  it("can be deleted only before it has generated anything", async () => {
    const { prep, template } = await world();
    const unused = await template({ name: "Unused template" });
    await deleteTemplate(prep, unused.id);
    expect(await db.recurringJournal.count({ where: { id: unused.id } })).toBe(0);
    const used = await template();
    await generateDue(prep, day("2026-08-31"));
    await expect(deleteTemplate(prep, used.id)).rejects.toThrow(/stay on record/);
  });
});

describe("who can do what, and per organization", () => {
  it("lets Finance run it by hand, refuses others, and keeps organizations apart", async () => {
    const { t, prep, hr, template, docsOf } = await world();
    const tpl = await template();
    await expect(runDueNow(hr, day("2026-10-10"))).rejects.toThrow(/permission/i);
    const other = await world();
    await other.template({ name: "Other org's template" });
    const r = await runDueNow(prep, day("2026-08-31"));
    expect(r.generated).toBe(1);
    expect(await docsOf(tpl.id)).toHaveLength(1);
    expect(await db.journalDocument.count({ where: { organizationId: other.t.org.id } })).toBe(0);
    expect(await getTemplate(prep, (await other.template({ name: "Another" })).id)).toBeNull();
    expect(t.org.id).not.toBe(other.t.org.id);
  });

  it("runs for every organization from the scheduler", async () => {
    const { t, template, docsOf } = await world();
    const tpl = await template({ startDate: "2020-01-31" });
    const out = await generateDueForAllOrgs(day("2020-02-29"));
    expect(out.find((o) => o.organization === t.org.name)).toMatchObject({ templates: 1, generated: 2 });
    expect(await docsOf(tpl.id)).toHaveLength(2);
  });
});
