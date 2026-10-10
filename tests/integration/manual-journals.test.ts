import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isolatedOrg, uid } from "../helpers";
import { ensureDefaultChart, updateAccount } from "@/server/services/accounting";
import { transitionPeriod, periodFor } from "@/server/services/periods";
import { postJournal } from "@/server/services/posting";
import { ledgerByDimension } from "@/server/services/dimensions";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";
import {
  approveDocument,
  cancelDocument,
  decideReversal,
  getDocument,
  listDocuments,
  listReversals,
  postDocument,
  postDueReversals,
  rejectDocument,
  requestReversal,
  reversalStateFor,
  runDueReversalsForAllOrgs,
  saveDraft,
  setApprovalRequired,
  submitDocument,
} from "@/server/services/journals";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function world() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const prep = t.ctx("FINANCE", null, 1); // prepares journals
  const prep2 = t.ctx("FINANCE", null, 2);
  const boss = t.ctx("COMPANY_ADMIN", null, 1); // approves
  const boss2 = t.ctx("COMPANY_ADMIN", null, 2);
  const hr = t.ctx("HR_ADMIN", null, 1);
  const acct = async (code: string) => (await db.glAccount.findUniqueOrThrow({ where: { organizationId_code: { organizationId: t.org.id, code } } })).id;
  const [cash, revenue, expense, payable, receivable, supplierControl] = await Promise.all([acct("1230"), acct("4100"), acct("5400"), acct("2130"), acct("1200"), acct("2180")]); // payable = an accrued liability, not a control account
  const client = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: "Alpha Bank" } });
  const ccA = await db.costCenter.create({ data: { organizationId: t.org.id, code: `A${uid()}`, name: "Lagos" } });
  const ccB = await db.costCenter.create({ data: { organizationId: t.org.id, code: `B${uid()}`, name: "Abuja" } });
  const draft = (over: Record<string, unknown> = {}, ctx = prep) =>
    saveDraft(ctx, null, {
      kind: "MANUAL",
      description: "Month-end adjustment",
      postingDate: "2026-08-31",
      lines: [{ accountId: cash, debit: 1000, credit: 0 }, { accountId: revenue, debit: 0, credit: 1000 }],
      ...over,
    } as never);
  /** Draft, submit, approve by someone else, and post. */
  const postManual = async (over: Record<string, unknown> = {}) => {
    const doc = await draft(over);
    await submitDocument(prep, doc.id);
    await approveDocument(boss, doc.id);
    await postDocument(boss, doc.id);
    return db.journalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { journal: { include: { lines: true } } } });
  };
  return { t, prep, prep2, boss, boss2, hr, cash, revenue, expense, payable, receivable, supplierControl, client, ccA, ccB, draft, postManual };
}

describe("a manual journal from draft to posted", () => {
  it("touches the ledger only when posted, and carries its source, period and lines", async () => {
    const { t, prep, boss, draft } = await world();
    const doc = await draft();
    expect(doc.documentNumber).toBe("MJ-000001");
    expect(doc.status).toBe("DRAFT");
    await submitDocument(prep, doc.id);
    await approveDocument(boss, doc.id);
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(0); // approved, not yet posted
    const j = await postDocument(boss, doc.id);
    expect(j.sourceType).toBe("MANUAL_JOURNAL");
    expect(j.sourceId).toBe(doc.id);
    expect(j.description).toMatch(/^MJ-000001/);
    expect(Number(j.totalDebit)).toBe(1000);
    expect(j.periodId).not.toBeNull();
    const posted = (await getDocument(boss, doc.id))!;
    expect(posted.status).toBe("POSTED");
    expect(posted.journal?.entryNumber).toBe(j.entryNumber);
    expect([posted.createdBy, posted.submittedBy, posted.decidedBy, posted.postedBy]).toEqual([prep.name, prep.name, boss.name, boss.name]);
    expect((await checkLedgerIntegrity(t.org.id)).findings).toEqual([]);
  });

  it("can be edited while a draft, and submitting says what is wrong", async () => {
    const { prep, draft, cash, revenue } = await world();
    const doc = await draft({ lines: [{ accountId: cash, debit: 500, credit: 0 }, { accountId: revenue, debit: 0, credit: 300 }] });
    await expect(submitDocument(prep, doc.id)).rejects.toThrow(/doesn't balance: debits are 500\.00 and credits 300\.00/);
    await saveDraft(prep, doc.id, { description: "Fixed", postingDate: "2026-08-31", lines: [{ accountId: cash, debit: 500, credit: 0 }, { accountId: revenue, debit: 0, credit: 500 }] } as never);
    await expect(submitDocument(prep, doc.id)).resolves.toMatchObject({ posted: false });
    expect((await getDocument(prep, doc.id))!.lines).toHaveLength(2);
    await expect(saveDraft(prep, doc.id, { description: "Too late", postingDate: "2026-08-31", lines: [] } as never)).rejects.toThrow(/Only a draft or a returned journal can be edited/);
  });

  it("refuses a line with an amount and no account, and an account from another organization, rather than dropping anything", async () => {
    const { prep, cash, revenue } = await world();
    const other = await world();
    const save = (lines: unknown[]) => saveDraft(prep, null, { description: "Bad lines", postingDate: "2026-08-31", lines } as never);
    await expect(save([{ accountId: cash, debit: 10, credit: 0 }, { accountId: "", debit: 0, credit: 10 }])).rejects.toThrow(/Line 2 has an amount but no account/);
    await expect(save([{ accountId: cash, debit: 10, credit: 0 }, { accountId: other.revenue, debit: 0, credit: 10 }])).rejects.toThrow(/account that doesn't exist in this organization/);
    await expect(save([{ accountId: cash, debit: 10, credit: 0 }, { accountId: revenue, debit: 0, credit: 10 }, { accountId: "", debit: 0, credit: 0 }])).resolves.toBeTruthy(); // a blank row is fine
  });

  it("needs a different person to approve it, and the right permissions at every step", async () => {
    const { prep, prep2, boss, hr, draft } = await world();
    await expect(draft({}, hr)).rejects.toThrow(/permission/i);
    const doc = await draft();
    await submitDocument(prep, doc.id);
    await expect(approveDocument(prep, doc.id)).rejects.toThrow(/permission/i); // finance prepares, doesn't approve
    await expect(approveDocument(prep2, doc.id)).rejects.toThrow(/permission/i);
    const own = await saveDraft(boss, null, { description: "Admin's own", postingDate: "2026-08-31", lines: [] } as never);
    expect(own.createdBy).toBe(boss.name);
    // an administrator who prepared and submitted a journal can't approve it either
    const adminDoc = await draft({}, boss);
    await submitDocument(boss, adminDoc.id);
    await expect(approveDocument(boss, adminDoc.id)).rejects.toThrow(/someone else has to approve/);
    await expect(approveDocument(boss, doc.id)).resolves.toMatchObject({ status: "APPROVED" });
    await expect(postDocument(prep, doc.id)).rejects.toThrow(/permission/i);
  });

  it("can be returned with a reason, corrected and resubmitted; or cancelled; but not once posted", async () => {
    const { prep, boss, boss2, draft, cash, revenue } = await world();
    const doc = await draft();
    await submitDocument(prep, doc.id);
    await expect(rejectDocument(boss, doc.id, "no")).rejects.toThrow(/Say why/);
    await rejectDocument(boss, doc.id, "The narration doesn't say which client this is for.");
    expect((await getDocument(prep, doc.id))!).toMatchObject({ status: "REJECTED", decisionNote: "The narration doesn't say which client this is for." });
    await saveDraft(prep, doc.id, { description: "Month-end adjustment — Alpha Bank", postingDate: "2026-08-31", lines: [{ accountId: cash, debit: 1000, credit: 0 }, { accountId: revenue, debit: 0, credit: 1000 }] } as never);
    await submitDocument(prep, doc.id);
    await approveDocument(boss2, doc.id);
    await rejectDocument(boss, doc.id, "Held back until the client confirms the figure."); // an approved one can still be returned before it posts
    await expect(postDocument(boss, doc.id)).rejects.toThrow(/returned/);

    const spare = await draft();
    await expect(cancelDocument(prep, spare.id, "no")).rejects.toThrow(/Say why/);
    await cancelDocument(prep, spare.id, "Entered twice by mistake");
    await expect(submitDocument(prep, spare.id)).rejects.toThrow(/cancelled/);
    const sent = await draft();
    await submitDocument(prep, sent.id);
    await expect(cancelDocument(prep, sent.id, "Changed my mind about it")).rejects.toThrow(/Only a draft or a returned journal can be cancelled/);
  });
});

describe("the database freezes a journal document once it leaves draft", () => {
  it("rejects changing lines or the description of a submitted or posted journal, and deleting one", async () => {
    const { draft, prep, boss, postManual, cash } = await world();
    const doc = await draft();
    const line = await db.journalDocumentLine.findFirstOrThrow({ where: { documentId: doc.id } });
    await expect(db.journalDocumentLine.update({ where: { id: line.id }, data: { description: "Edited while still a draft" } })).resolves.toBeTruthy(); // a draft can be edited
    await submitDocument(prep, doc.id);
    await expect(db.journalDocumentLine.update({ where: { id: line.id }, data: { debit: 9999 } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.journalDocumentLine.create({ data: { documentId: doc.id, accountId: cash, description: "extra", debit: 1, credit: 0 } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.journalDocumentLine.deleteMany({ where: { documentId: doc.id } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.journalDocument.update({ where: { id: doc.id }, data: { description: "Sneaky" } })).rejects.toThrow(/cannot be edited/i);
    await expect(db.journalDocument.delete({ where: { id: doc.id } })).rejects.toThrow(/cannot be deleted/i);
    await approveDocument(boss, doc.id); // status and decision fields still move forward

    const posted = await postManual();
    await expect(db.journalDocument.update({ where: { id: posted.id }, data: { status: "DRAFT" } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.journalDocument.delete({ where: { id: posted.id } })).rejects.toThrow(/cannot be deleted/i);
    await expect(db.journalDocumentLine.deleteMany({ where: { documentId: posted.id } })).rejects.toThrow(/cannot be changed/i);
  });

  it("lets a draft that was never submitted be deleted outright, lines and all", async () => {
    const { draft } = await world();
    const doc = await draft();
    await expect(db.journalDocument.delete({ where: { id: doc.id } })).resolves.toBeTruthy();
    expect(await db.journalDocumentLine.count({ where: { documentId: doc.id } })).toBe(0);
  });
});

describe("accounting periods and journals", () => {
  it("refuses to submit into a closed period, and refuses to post if the period closed after approval", async () => {
    const { t, prep, boss, boss2, draft } = await world();
    const aug = await periodFor(db, t.org.id, day("2026-08-31"));
    await transitionPeriod(prep, aug.id, "SOFT_CLOSE");
    await transitionPeriod(boss, aug.id, "CLOSE");
    const late = await draft();
    await expect(submitDocument(prep, late.id)).rejects.toThrow(/Aug 2026 is closed/);

    const sept = await draft({ postingDate: "2026-09-30" });
    await submitDocument(prep, sept.id);
    await approveDocument(boss, sept.id);
    const septPeriod = await periodFor(db, t.org.id, day("2026-09-30"));
    await transitionPeriod(prep, septPeriod.id, "SOFT_CLOSE");
    await transitionPeriod(boss2, septPeriod.id, "CLOSE");
    await expect(postDocument(boss, sept.id)).rejects.toThrow(/Sep 2026 is closed/);
    expect((await getDocument(boss, sept.id))!.status).toBe("APPROVED"); // nothing half-done
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(0);
  });
});

describe("dimensions and required dimensions on a manual journal", () => {
  it("carries a line's dimensions to the ledger, and refuses a bad or missing one at submit", async () => {
    const { t, prep, boss, draft, cash, revenue, client, ccA } = await world();
    const other = await world();
    const withDims = (dimensions: Record<string, string>) => ({ lines: [{ accountId: cash, debit: 700, credit: 0 }, { accountId: revenue, debit: 0, credit: 700, dimensions }] });
    const good = await draft(withDims({ clientId: client.id, costCenterId: ccA.id }));
    await submitDocument(prep, good.id);
    await approveDocument(boss, good.id);
    const j = await postDocument(boss, good.id);
    const stored = await db.journalLine.findFirstOrThrow({ where: { journalId: j.id, accountCode: "4100" } });
    expect([stored.clientId, stored.costCenterId]).toEqual([client.id, ccA.id]);
    expect((await ledgerByDimension(boss, { dimension: "CLIENT" })).rows.find((r) => r.id === client.id)?.income).toBe(700);

    const bad = await draft(withDims({ clientId: other.client.id }));
    await expect(submitDocument(prep, bad.id)).rejects.toThrow(/client that doesn't exist in this organization/);

    const rev = await db.glAccount.findUniqueOrThrow({ where: { organizationId_code: { organizationId: t.org.id, code: "4100" } } });
    await updateAccount(boss, rev.id, { requiredDimensions: ["CLIENT"] });
    const missing = await draft();
    await expect(submitDocument(prep, missing.id)).rejects.toThrow(/needs a client/);
  });
});

describe("control accounts", () => {
  it("won't let a manual journal post to receivables or payables, at submit or at post", async () => {
    const { prep, draft, cash, receivable, supplierControl, revenue } = await world();
    const ar = await draft({ lines: [{ accountId: receivable, debit: 100, credit: 0 }, { accountId: revenue, debit: 0, credit: 100 }] });
    await expect(submitDocument(prep, ar.id)).rejects.toThrow(/1200 Accounts Receivable is the receivables control account.*client invoices, receipts, credit notes and deductions/);
    const ap = await draft({ lines: [{ accountId: cash, debit: 100, credit: 0 }, { accountId: supplierControl, debit: 0, credit: 100 }] });
    await expect(submitDocument(prep, ap.id)).rejects.toThrow(/2180 Accounts Payable is the payables control account.*supplier bills, payments and deductions/);
  });
});

describe("whether manual journals need approval is a setting", () => {
  it("lets the preparer's submission post straight away when approval is switched off, on the record, and only a period approver can switch it", async () => {
    const { t, prep, boss, draft } = await world();
    await expect(setApprovalRequired(prep, false)).rejects.toThrow(/permission/i);
    await setApprovalRequired(boss, false);
    const doc = await draft();
    const r = await submitDocument(prep, doc.id);
    expect(r.posted).toBe(true);
    const posted = (await getDocument(prep, doc.id))!;
    expect(posted.status).toBe("POSTED");
    expect(posted.decisionNote).toMatch(/Approval not required/);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "JOURNAL_DOC_APPROVE_WAIVED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "JOURNAL_APPROVAL_SETTING" } })).toBe(1);
    await setApprovalRequired(boss, true);
    const next = await draft();
    expect((await submitDocument(prep, next.id)).posted).toBe(false);
  });
});

describe("reversing a posted manual journal", () => {
  it("needs a reason and a date, a different approver, then posts an exact mirror beside the untouched original", async () => {
    const { t, prep, prep2, boss, boss2, postManual, client, cash, revenue } = await world();
    const doc = await postManual({ lines: [{ accountId: cash, debit: 900, credit: 0 }, { accountId: revenue, debit: 0, credit: 900, dimensions: { clientId: client.id } }] });
    const original = doc.journal!;
    await expect(requestReversal(prep, original.id, "short", "2026-09-05")).rejects.toThrow(/Say why/);
    await expect(requestReversal(prep, original.id, "Posted to the wrong client by mistake.", "2026-08-01")).rejects.toThrow(/can't be dated before/);
    const req = await requestReversal(prep, original.id, "Posted to the wrong client by mistake.", "2026-09-05");
    await expect(requestReversal(prep2, original.id, "Another request for the same journal.", "2026-09-05")).rejects.toThrow(/already waiting/);
    await expect(decideReversal(prep, req.id, true)).rejects.toThrow(/permission/i);
    const adminReq = await (async () => {
      // an administrator who asked can't approve their own request
      const other = await postManual();
      const r = await requestReversal(boss, other.journal!.id, "Duplicate of an entry made earlier.", "2026-09-05");
      await expect(decideReversal(boss, r.id, true)).rejects.toThrow(/someone else has to approve/);
      return r;
    })();
    expect(adminReq.status).toBe("PENDING");

    await decideReversal(boss, req.id, true, "Agreed.");
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { reversalOfId: original.id }, include: { lines: true } });
    expect(reversal.postingDate.toISOString().slice(0, 10)).toBe("2026-09-05");
    expect(reversal.description).toMatch(/^Reversal of JV-\d+: Posted to the wrong client/);
    expect(reversal.sourceType).toBe("JOURNAL_REVERSAL");
    const rev = reversal.lines.find((l) => l.accountCode === "4100")!;
    expect([Number(rev.debit), rev.clientId]).toEqual([900, client.id]);
    // the original is untouched, and the ledger nets to nil in every dimension
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: original.id } })).description).toBe(original.description);
    expect((await ledgerByDimension(boss, { dimension: "CLIENT" })).rows.find((r) => r.id === client.id)?.net).toBe(0);
    expect((await checkLedgerIntegrity(t.org.id)).findings).toEqual([]);

    const state = (await reversalStateFor(boss, original.id))!;
    expect([state.ok, state.reversedBy?.entryNumber]).toEqual([false, reversal.entryNumber]);
    await expect(requestReversal(prep, original.id, "Trying to reverse it a second time.", "2026-09-06")).rejects.toThrow(/already been reversed/);
    await expect(requestReversal(prep, reversal.id, "Trying to reverse the reversal itself.", "2026-09-06")).rejects.toThrow(/itself a reversal/);
    expect(await db.journalReversal.count({ where: { organizationId: t.org.id, status: "APPROVED" } })).toBe(1);
    expect((await listReversals(boss)).length).toBe(2);
    void boss2;
  });

  it("can be turned down with a reason, and then asked for again", async () => {
    const { prep, boss, postManual } = await world();
    const doc = await postManual();
    const req = await requestReversal(prep, doc.journal!.id, "Thought it was posted twice, it wasn't.", "2026-09-05");
    await expect(decideReversal(boss, req.id, false)).rejects.toThrow(/Say why/);
    await decideReversal(boss, req.id, false, "Checked the ledger: it was only posted once.");
    expect((await db.journalReversal.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("REJECTED");
    await expect(decideReversal(boss, req.id, true)).rejects.toThrow(/already rejected/);
    await expect(requestReversal(prep, doc.journal!.id, "Asking again with the right evidence now.", "2026-09-06")).resolves.toBeTruthy();
  });

  it("refuses a journal that another part of the system made, and says to use its document", async () => {
    const { t, prep } = await world();
    const sys = (await postJournal(t.ctx("FINANCE"), db, {
      source: "AR_INVOICE", sourceType: "CLIENT_INVOICE", sourceId: "inv-1", postingDate: day("2026-08-31"), description: "Client invoice",
      lines: [{ accountCode: "1200", description: "a", debit: 100, credit: 0 }, { accountCode: "4100", description: "b", debit: 0, credit: 100 }],
    }))!;
    await expect(requestReversal(prep, sys.id, "Trying to undo an invoice journal directly.", "2026-09-05")).rejects.toThrow(/through the document that produced it/);
    expect((await reversalStateFor(prep, sys.id))!.reason).toMatch(/cancel the invoice or bill/);
  });

  it("is refused at the request if the books won't accept the date, and at approval if they closed in between", async () => {
    const { t, prep, boss, boss2, postManual } = await world();
    const doc = await postManual();
    const aug = await periodFor(db, t.org.id, day("2026-08-31"));
    await transitionPeriod(prep, aug.id, "SOFT_CLOSE");
    await transitionPeriod(boss, aug.id, "CLOSE"); // earlier periods with postings close first
    const sept = await periodFor(db, t.org.id, day("2026-09-15"));
    await transitionPeriod(prep, sept.id, "SOFT_CLOSE");
    await transitionPeriod(boss, sept.id, "CLOSE");
    await expect(requestReversal(prep, doc.journal!.id, "Wrong client, to be put right.", "2026-09-15")).rejects.toThrow(/Sep 2026 is closed/);
    const oct = await periodFor(db, t.org.id, day("2026-10-15"));
    const req = await requestReversal(prep, doc.journal!.id, "Wrong client, to be put right.", "2026-10-15");
    await transitionPeriod(prep, oct.id, "SOFT_CLOSE");
    await transitionPeriod(boss2, oct.id, "CLOSE");
    await expect(decideReversal(boss, req.id, true)).rejects.toThrow(/Oct 2026 is closed/);
    expect((await db.journalReversal.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING");
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id, reversalOfId: { not: null } } })).toBe(0);
  });

  it("is per organization", async () => {
    const a = await world();
    const b = await world();
    const doc = await a.postManual();
    await expect(requestReversal(b.prep, doc.journal!.id, "Not mine to reverse at all.", "2026-09-05")).rejects.toThrow(/Journal not found/);
    expect(await reversalStateFor(b.prep, doc.journal!.id)).toBeNull();
    expect(await listDocuments(b.prep)).toEqual([]);
    expect(await getDocument(b.prep, doc.id)).toBeNull();
  });
});

describe("accruals reverse themselves", () => {
  it("must say when they reverse, post now, and are reversed automatically once on the date, never twice", async () => {
    const { t, prep, boss, draft, expense, payable } = await world();
    const lines = [{ accountId: expense, debit: 4000, credit: 0 }, { accountId: payable, debit: 0, credit: 4000 }];
    const noDate = await draft({ kind: "ACCRUAL", lines });
    await expect(submitDocument(prep, noDate.id)).rejects.toThrow(/needs the date it reverses on/);
    const doc = await draft({ kind: "ACCRUAL", reverseOn: "2026-09-01", lines });
    await submitDocument(prep, doc.id);
    await approveDocument(boss, doc.id);
    const accrual = await postDocument(boss, doc.id);

    expect((await postDueReversals(boss, day("2026-08-31"))).due).toBe(0); // not yet
    const r = await postDueReversals(boss, day("2026-09-01"));
    expect([r.due, r.posted, r.failed]).toEqual([1, 1, []]);
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { reversalOfId: accrual.id } });
    expect(reversal.postingDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(reversal.description).toMatch(/Automatic reversal of accrual MJ-/);
    expect((await postDueReversals(boss, day("2026-09-30"))).due).toBe(0); // never twice
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id, reversalOfId: { not: null } } })).toBe(1);
    expect((await checkLedgerIntegrity(t.org.id)).findings).toEqual([]);
  });

  it("reports an accrual whose reversal date is in a closed period and carries on with the rest", async () => {
    const { t, prep, boss, boss2, draft, expense, payable } = await world();
    const lines = [{ accountId: expense, debit: 100, credit: 0 }, { accountId: payable, debit: 0, credit: 100 }];
    const mk = async (reverseOn: string) => {
      const doc = await draft({ kind: "ACCRUAL", reverseOn, lines });
      await submitDocument(prep, doc.id);
      await approveDocument(boss, doc.id);
      await postDocument(boss, doc.id);
      return doc;
    };
    const stuck = await mk("2026-09-01");
    await mk("2026-10-01");
    const aug = await periodFor(db, t.org.id, day("2026-08-31"));
    await transitionPeriod(prep, aug.id, "SOFT_CLOSE");
    await transitionPeriod(boss, aug.id, "CLOSE");
    const sept = await periodFor(db, t.org.id, day("2026-09-01"));
    await transitionPeriod(prep, sept.id, "SOFT_CLOSE");
    await transitionPeriod(boss2, sept.id, "CLOSE");
    const r = await postDueReversals(boss, day("2026-10-02"));
    expect([r.due, r.posted]).toEqual([2, 1]);
    expect(r.failed).toEqual([{ documentNumber: stuck.documentNumber, reason: expect.stringMatching(/Sep 2026 is closed/) }]);
  });

  it("runs for every organization as the system, for the scheduler", async () => {
    const { prep, boss, draft, expense, payable } = await world();
    const doc = await draft({ kind: "ACCRUAL", reverseOn: "2026-09-01", lines: [{ accountId: expense, debit: 50, credit: 0 }, { accountId: payable, debit: 0, credit: 50 }] });
    await submitDocument(prep, doc.id);
    await approveDocument(boss, doc.id);
    await postDocument(boss, doc.id);
    const out = await runDueReversalsForAllOrgs(day("2026-09-02"));
    expect(out.reduce((a, o) => a + o.posted, 0)).toBeGreaterThanOrEqual(1);
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { reversalOf: { document: { id: doc.id } } } });
    expect(reversal.postedBy).toBe("System (automatic reversal)");
  });
});

describe("other kinds of journal", () => {
  it("a reclassification moves a result from one cost centre to another without changing the total", async () => {
    const { t, prep, boss, draft, expense, ccA, ccB, payable } = await world();
    const first = await draft({ lines: [{ accountId: expense, debit: 800, credit: 0, dimensions: { costCenterId: ccA.id } }, { accountId: payable, debit: 0, credit: 800 }] });
    await submitDocument(prep, first.id);
    await approveDocument(boss, first.id);
    await postDocument(boss, first.id);
    const move = await draft({ kind: "RECLASSIFICATION", description: "Move site costs to Abuja", lines: [{ accountId: expense, debit: 300, credit: 0, dimensions: { costCenterId: ccB.id } }, { accountId: expense, debit: 0, credit: 300, dimensions: { costCenterId: ccA.id } }] });
    await submitDocument(prep, move.id);
    await approveDocument(boss, move.id);
    await postDocument(boss, move.id);
    const by = (await ledgerByDimension(boss, { dimension: "COST_CENTER" })).rows;
    expect([by.find((r) => r.id === ccA.id)?.expense, by.find((r) => r.id === ccB.id)?.expense]).toEqual([500, 300]);
    expect((await ledgerByDimension(boss, { dimension: "COST_CENTER" })).totals.expense).toBe(800);
    expect((await checkLedgerIntegrity(t.org.id)).findings).toEqual([]);
    expect((await listDocuments(boss, { status: "POSTED" })).map((d) => d.kind).sort()).toEqual(["MANUAL", "RECLASSIFICATION"]);
  });
});

describe("the integrity check on reversals", () => {
  it("flags a reversal that doesn't cancel its original exactly", async () => {
    const { t, postManual, cash, revenue } = await world();
    const doc = await postManual();
    const original = doc.journal!;
    const bad = await db.journalEntry.create({
      data: { organizationId: t.org.id, entryNumber: "JV-BAD001", reversalOfId: original.id, postingDate: day("2026-09-05"), description: "Wrong reversal", source: "JOURNAL_REVERSAL", totalDebit: 400, totalCredit: 400, postedBy: "test",
        lines: { create: [{ accountId: revenue, accountCode: "4100", accountName: "x", headCode: "x", description: "a", debit: 400, credit: 0 }, { accountId: cash, accountCode: "1230", accountName: "x", headCode: "x", description: "b", debit: 0, credit: 400 }] } },
    });
    const r = await checkLedgerIntegrity(t.org.id);
    expect(r.findings.find((f) => f.check === "REVERSAL_MISMATCH")?.ref).toBe(bad.entryNumber);
    expect(r.ok).toBe(false);
  });
});
