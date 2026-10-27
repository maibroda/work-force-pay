/**
 * A client's monthly inputs sent as a file. The client's HR contact uploads a CSV of overtime, allowances, bonuses and deductions; every row is
 * checked on the server (the preview is only a preview) and a file with any error is refused whole. A good file becomes a *batch* that waits for
 * the bureau: nothing reaches the payroll until someone on the bureau's side accepts it, and then each row becomes an ordinary approved earning
 * or deduction. What the client sent is kept exactly as sent. Uploading marks the matching inputs on the month's tracker as received (so the
 * reminders stop); refusing or withdrawing puts them back.
 */
import { createHash } from "node:crypto";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { iso } from "@/lib/dates";
import { totalOf } from "@/lib/payroll/pay-inputs";
import { checkInputs, INPUT_TYPE_LABELS, isDeduction, TRACKER_KIND, type CheckedItem, type ExistingInput, type InputCheck, type InputEmployee, type InputType } from "@/lib/client-inputs";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { notify } from "./client-queries";
import { teamEmails } from "./payroll-reminders";

/** A month whose payroll has been approved no longer takes inputs: the same line the tracker draws. */
const CLOSED_PERIOD = ["APPROVED", "LOCKED", "PAID", "CLOSED"];
const LEFT = ["TERMINATED", "RESIGNED", "EXITED", "INACTIVE"];

const isClient = (ctx: Ctx) => can(ctx.role, "portal.inputs");
function assertCanSee(ctx: Ctx) {
  if (!can(ctx.role, "portal.view") && !can(ctx.role, "payroll.view")) assertCan(ctx, "portal.view");
}

async function loadPeriod(orgId: string, periodId: string) {
  const p = await db.payrollPeriod.findFirst({ where: { id: periodId, organizationId: orgId }, include: { calendarEntry: { select: { inputCutoff: true } } } });
  if (!p) throw new BusinessError("That month was not found.");
  return p;
}

/** The months a client can still send inputs for, newest first. */
export async function uploadableMonths(ctx: Ctx) {
  assertCanSee(ctx);
  const periods = await db.payrollPeriod.findMany({ where: { organizationId: ctx.orgId, status: { notIn: CLOSED_PERIOD as never[] } }, include: { calendarEntry: { select: { inputCutoff: true } } }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 4 });
  return periods.map((p) => ({ id: p.id, name: p.name, cutoff: p.calendarEntry?.inputCutoff ? iso(p.calendarEntry.inputCutoff) : null }));
}

async function reference(orgId: string, periodId: string): Promise<{ employees: InputEmployee[]; existing: ExistingInput[] }> {
  const [emps, earnings, deductions, waiting] = await Promise.all([
    db.employee.findMany({ where: { organizationId: orgId }, select: { id: true, employeeNumber: true, firstName: true, lastName: true, status: true } }),
    db.otherEarning.findMany({ where: { organizationId: orgId, periodId, status: { in: ["PENDING", "APPROVED", "PROCESSED"] } }, select: { employeeId: true, name: true, amount: true } }),
    db.deduction.findMany({ where: { organizationId: orgId, periodId, status: { in: ["PENDING", "APPROVED", "PROCESSED"] } }, select: { employeeId: true, reason: true, amount: true } }),
    db.clientInputRow.findMany({ where: { organizationId: orgId, appliedId: null, batch: { periodId, status: "SUBMITTED" } }, select: { employeeId: true, type: true, description: true, amount: true } }),
  ]);
  return {
    employees: emps.map((e) => ({ id: e.id, employeeNumber: e.employeeNumber, name: `${e.firstName} ${e.lastName}`, status: e.status })),
    existing: [
      ...earnings.map((x) => ({ employeeId: x.employeeId, deduction: false, name: x.name, amount: Number(x.amount) })),
      ...deductions.map((x) => ({ employeeId: x.employeeId, deduction: true, name: x.reason, amount: Number(x.amount) })),
      ...waiting.map((x) => ({ employeeId: x.employeeId, deduction: isDeduction(x.type as InputType), name: x.description, amount: Number(x.amount) })),
    ],
  };
}

const checksumOf = (csv: string) => createHash("sha256").update(csv.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim()).digest("hex");

async function sameFileSent(orgId: string, periodId: string, checksum: string) {
  return db.clientInputBatch.findFirst({ where: { organizationId: orgId, periodId, checksum, status: { in: ["SUBMITTED", "ACCEPTED"] } }, select: { number: true, status: true } });
}

/** Checks a file without writing anything. */
export async function previewClientInputs(ctx: Ctx, periodId: string, csv: string): Promise<InputCheck & { sameFile: string | null; closed: string | null }> {
  assertCan(ctx, "portal.inputs");
  const period = await loadPeriod(ctx.orgId, periodId);
  const check = checkInputs(csv, await reference(ctx.orgId, periodId));
  const dup = await sameFileSent(ctx.orgId, periodId, checksumOf(csv));
  return { ...check, sameFile: dup ? `${dup.number} (${dup.status === "ACCEPTED" ? "already accepted" : "waiting for review"})` : null, closed: CLOSED_PERIOD.includes(period.status) ? `${period.name}'s payroll has already been approved, so it no longer takes inputs. Ask your payroll contact.` : null };
}

export async function submitClientInputs(ctx: Ctx, input: { periodId: string; csv: string; fileName: string; note?: string }) {
  assertCan(ctx, "portal.inputs");
  const period = await loadPeriod(ctx.orgId, input.periodId);
  if (CLOSED_PERIOD.includes(period.status)) throw new BusinessError(`${period.name}'s payroll has already been approved, so it no longer takes inputs. Ask your payroll contact.`);
  const check = checkInputs(input.csv, await reference(ctx.orgId, input.periodId));
  if (check.fatal) throw new BusinessError(check.fatal);
  if (check.summary.errors > 0) throw new BusinessError(`${check.summary.errors} row(s) have errors, so nothing was sent. Fix them in the file and send it again.`);
  const items = check.rows.map((r) => r.item).filter((i): i is CheckedItem => !!i);
  if (!items.length) throw new BusinessError("There are no rows to send.");
  const checksum = checksumOf(input.csv);
  const dup = await sameFileSent(ctx.orgId, input.periodId, checksum);
  if (dup) throw new BusinessError(`This exact file has already been sent for ${period.name} as ${dup.number}.`);

  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, bureauOrganizationId: true } });
  const cutoff = period.calendarEntry?.inputCutoff ? iso(period.calendarEntry.inputCutoff) : null;
  const late = !!cutoff && iso(new Date()) > cutoff;
  const fileName = input.fileName.trim().slice(0, 200) || "inputs.csv";
  const note = input.note?.trim() || null;
  const earningsTotal = totalOf(items.filter((i) => !isDeduction(i.type)).map((i) => i.amount));
  const deductionsTotal = totalOf(items.filter((i) => isDeduction(i.type)).map((i) => i.amount));

  const batch = await db.$transaction(
    async (tx) => {
      const number = await nextNumber(tx, ctx.orgId, "CLIENT_INPUT");
      // the tracker's inputs this file covers that were still expected: they are now received
      const kinds = [...new Set(items.map((i) => TRACKER_KIND[i.type]))];
      const expected = await tx.payrollInputItem.findMany({ where: { periodId: input.periodId, organizationId: ctx.orgId, kind: { in: kinds }, status: "EXPECTED" } });
      const created = await tx.clientInputBatch.create({
        data: {
          organizationId: ctx.orgId,
          periodId: input.periodId,
          number,
          fileName,
          checksum,
          rowCount: items.length,
          warningCount: check.rows.filter((r) => r.item && r.warnings.length).length,
          earningsTotal,
          deductionsTotal,
          late,
          note,
          markedKinds: expected.map((e) => e.kind),
          submittedBy: ctx.name,
          submittedByUserId: ctx.userId,
        },
      });
      await tx.clientInputRow.createMany({
        data: check.rows
          .filter((r) => r.item)
          .map((r) => ({
            organizationId: ctx.orgId,
            batchId: created.id,
            line: r.line,
            employeeId: r.item!.employeeId,
            type: r.item!.type,
            description: r.item!.description,
            amount: r.item!.amount,
            taxable: r.item!.taxable,
            reference: r.item!.reference,
            note: r.item!.note,
            warnings: r.warnings,
          })),
      });
      for (const e of expected)
        await tx.payrollInputItem.update({ where: { id: e.id }, data: { status: "RECEIVED", receivedAt: new Date(), markedBy: ctx.name, markedByUserId: ctx.userId, note: `Uploaded in the portal by ${ctx.name} (${number})` } });
      await logAudit(ctx, { action: "CLIENT_INPUTS_SUBMIT", entity: "ClientInputBatch", entityId: created.id, newValue: { number, period: period.name, rows: items.length, earnings: earningsTotal, deductions: deductionsTotal, late } }, tx);
      return created;
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  await notify(
    await teamEmails(ctx.orgId, org.bureauOrganizationId, []),
    `${org.name} sent inputs for ${period.name} (${batch.number})`,
    `${ctx.name} (${org.name}) sent ${items.length} input(s) for ${period.name}${late ? ", after the cut-off" : ""}.\n\nWork in ${org.name} and open Client Inputs to review and accept them.`,
  );
  return batch;
}

async function undoTracker(tx: Tx, batch: { organizationId: string; periodId: string; number: string; markedKinds: string[] }) {
  // only what this upload marked, and only if nobody has touched it since
  await tx.payrollInputItem.updateMany({
    where: { organizationId: batch.organizationId, periodId: batch.periodId, kind: { in: batch.markedKinds }, status: "RECEIVED", note: { contains: batch.number } },
    data: { status: "EXPECTED", receivedAt: null, markedBy: null, markedByUserId: null, note: null },
  });
}

/** The client takes back an upload that nobody has decided yet. */
export async function withdrawClientInputs(ctx: Ctx, id: string) {
  assertCan(ctx, "portal.inputs");
  const b = await db.clientInputBatch.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!b) throw new BusinessError("Upload not found.");
  if (b.status !== "SUBMITTED") throw new BusinessError(`This upload is already ${b.status.toLowerCase()}.`);
  await db.$transaction(async (tx) => {
    await tx.clientInputBatch.update({ where: { id }, data: { status: "WITHDRAWN", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: "Withdrawn by the client." } });
    await undoTracker(tx, b);
    await logAudit(ctx, { action: "CLIENT_INPUTS_WITHDRAW", entity: "ClientInputBatch", entityId: id, newValue: { number: b.number } }, tx);
  });
}

/** Everything a reviewer should know before accepting: why it can't be, if it can't. */
async function blockers(orgId: string, batch: { id: string; periodId: string }) {
  const [period, rows] = await Promise.all([
    db.payrollPeriod.findUniqueOrThrow({ where: { id: batch.periodId }, select: { name: true, status: true } }),
    db.clientInputRow.findMany({ where: { batchId: batch.id }, select: { line: true, employee: { select: { employeeNumber: true, firstName: true, lastName: true, status: true } } } }),
  ]);
  const out: string[] = [];
  if (CLOSED_PERIOD.includes(period.status)) out.push(`${period.name}'s payroll has already been approved, so these can no longer be added to it.`);
  const gone = rows.filter((r) => LEFT.includes(r.employee.status));
  if (gone.length) out.push(`${gone.map((r) => `${r.employee.employeeNumber} ${r.employee.firstName} ${r.employee.lastName}`).filter((v, i, a) => a.indexOf(v) === i).join(", ")} ${gone.length === 1 ? "has" : "have"} left the payroll since this was sent (line${gone.length === 1 ? "" : "s"} ${gone.map((r) => r.line).join(", ")}).`);
  return out;
}

export async function listClientInputs(ctx: Ctx) {
  assertCanSee(ctx);
  const rows = await db.clientInputBatch.findMany({ where: { organizationId: ctx.orgId }, include: { period: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }], take: 100 });
  return rows;
}

export async function getClientInputs(ctx: Ctx, id: string) {
  assertCanSee(ctx);
  const b = await db.clientInputBatch.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { period: { select: { name: true, status: true } }, rows: { include: { employee: { select: { employeeNumber: true, firstName: true, lastName: true } } }, orderBy: { line: "asc" } } },
  });
  if (!b) throw new BusinessError("Upload not found.");
  return { ...b, blockers: b.status === "SUBMITTED" ? await blockers(ctx.orgId, b) : [], labels: INPUT_TYPE_LABELS, mine: isClient(ctx) };
}

/** Uploads waiting for the bureau, in the client being worked on. */
export async function waitingClientInputs(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  return db.clientInputBatch.count({ where: { organizationId: ctx.orgId, status: "SUBMITTED" } });
}

const DEDUCTION_TYPE = { DEDUCTION: "OTHER", PENALTY: "PENALTY", RECOVERY: "RECOVERY", SALARY_ADVANCE: "SALARY_ADVANCE" } as const;

/** The bureau accepts an upload: each row becomes an approved earning or deduction for the month. */
export async function acceptClientInputs(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.inputs.approve");
  const b = await db.clientInputBatch.findFirst({ where: { id, organizationId: ctx.orgId }, include: { rows: { orderBy: { line: "asc" } } } });
  if (!b) throw new BusinessError("Upload not found.");
  if (b.status !== "SUBMITTED") throw new BusinessError(`This upload is already ${b.status.toLowerCase()}.`);
  if (b.submittedByUserId === ctx.userId) throw new BusinessError("You sent this upload, so someone else has to accept it.");
  const problems = await blockers(ctx.orgId, b);
  if (problems.length) throw new BusinessError(problems.join(" "));

  const result = await db.$transaction(
    async (tx) => {
      for (const r of b.rows) {
        const type = r.type as InputType;
        if (isDeduction(type)) {
          const d = await tx.deduction.create({
            data: {
              organizationId: ctx.orgId,
              employeeId: r.employeeId,
              deductionType: DEDUCTION_TYPE[type as keyof typeof DEDUCTION_TYPE],
              amount: r.amount,
              periodId: b.periodId,
              reason: r.note ? `${r.description}: ${r.note}` : r.description,
              authorityReference: r.reference ?? "",
              requestedBy: b.submittedBy,
              approvedBy: ctx.name,
              status: "APPROVED",
            },
          });
          await tx.clientInputRow.update({ where: { id: r.id }, data: { appliedKind: "Deduction", appliedId: d.id } });
        } else {
          const e = await tx.otherEarning.create({
            data: {
              organizationId: ctx.orgId,
              employeeId: r.employeeId,
              periodId: b.periodId,
              name: r.description,
              amount: r.amount,
              taxable: r.taxable,
              reason: r.note ?? `${INPUT_TYPE_LABELS[type]} sent by ${b.submittedBy} in the portal (${b.number})`,
              approvedBy: ctx.name,
              status: "APPROVED",
            },
          });
          await tx.clientInputRow.update({ where: { id: r.id }, data: { appliedKind: "OtherEarning", appliedId: e.id } });
        }
      }
      await tx.clientInputBatch.update({ where: { id }, data: { status: "ACCEPTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date() } });
      await logAudit(ctx, { action: "CLIENT_INPUTS_ACCEPT", entity: "ClientInputBatch", entityId: id, newValue: { number: b.number, rows: b.rows.length, earnings: Number(b.earningsTotal), deductions: Number(b.deductionsTotal) } }, tx);
      // a payroll already calculated for the month doesn't include these until it is calculated again
      const run = await tx.payrollRun.findFirst({ where: { periodId: b.periodId, organizationId: ctx.orgId, type: "REGULAR", status: { notIn: ["DRAFT", "SUPERSEDED"] } }, select: { id: true } });
      return { rows: b.rows.length, recalculate: !!run };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  await tellSubmitter(b, `Your inputs ${b.number} were accepted`, `The ${b.rowCount} input(s) you sent for the month (${b.number}) were accepted by ${ctx.name} and will be in the payroll.`);
  return result;
}

/** The bureau sends an upload back with a reason; the client fixes the file and sends it again. */
export async function rejectClientInputs(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "payroll.inputs.approve");
  const text = (reason ?? "").trim();
  if (text.length < 5) throw new BusinessError("Say what needs to change, so the client knows what to put right.");
  const b = await db.clientInputBatch.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!b) throw new BusinessError("Upload not found.");
  if (b.status !== "SUBMITTED") throw new BusinessError(`This upload is already ${b.status.toLowerCase()}.`);
  await db.$transaction(async (tx) => {
    await tx.clientInputBatch.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: text } });
    await undoTracker(tx, b);
    await logAudit(ctx, { action: "CLIENT_INPUTS_REJECT", entity: "ClientInputBatch", entityId: id, newValue: { number: b.number }, reason: text }, tx);
  });
  await tellSubmitter(b, `Your inputs ${b.number} need changes`, `${ctx.name} sent back the inputs you uploaded (${b.number}):\n\n${text}\n\nPlease correct the file and send it again in the portal.`);
}

async function tellSubmitter(b: { submittedByUserId: string }, subject: string, text: string) {
  const u = await db.user.findUnique({ where: { id: b.submittedByUserId }, select: { email: true, active: true } });
  if (u?.active) await notify([u.email], subject, text);
}
