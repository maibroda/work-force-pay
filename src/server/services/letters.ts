/**
 * Letter generation. Each organization has editable wording for seven kinds of letter (offer,
 * employment confirmation, probation confirmation, warning, exit, experience, clearance certificate).
 * Generating one merges a record's details into the template and stores the finished text with a
 * reference number — so editing a template later never rewrites a letter already issued.
 *
 * Each letter is only available when the record supports it: an offer must be approved, a warning
 * must be signed off, a probation confirmation needs a confirmed probation, an experience letter
 * needs a leaver, and a clearance certificate needs every required clearance step finished.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { fmtDate } from "@/lib/dates";
import { DEFAULT_TEMPLATES, LETTER_LABELS, LETTER_TYPES, serviceLength, unknownFields, renderTemplate, type LetterTypeKey } from "@/lib/letters";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";
import { nextNumber } from "./numbering";

const GONE = ["EXITED", "TERMINATED", "RESIGNED"];
const lower = (s: string) => s.replace(/_/g, " ").toLowerCase();

// ───────────────────────────── Templates ─────────────────────────────

export async function ensureTemplates(orgId: string, tx: Tx = db) {
  await tx.letterTemplate.createMany({
    data: LETTER_TYPES.map((type) => ({
      organizationId: orgId,
      type,
      subject: DEFAULT_TEMPLATES[type].subject,
      body: DEFAULT_TEMPLATES[type].body,
      signatoryTitle: DEFAULT_TEMPLATES[type].signatoryTitle,
    })),
    skipDuplicates: true,
  });
}

export async function listTemplates(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  await ensureTemplates(ctx.orgId);
  const rows = await db.letterTemplate.findMany({ where: { organizationId: ctx.orgId } });
  return LETTER_TYPES.map((t) => rows.find((r) => r.type === t)!);
}

export const templateSchema = z.object({
  type: z.enum(LETTER_TYPES),
  subject: z.string().trim().min(3, "The subject is required").max(200),
  body: z.string().trim().min(20, "The letter needs some wording").max(8000),
  signatoryName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v ?? ""),
  signatoryTitle: z.string().trim().min(1, "Give the signatory's title").max(120),
});

export async function saveTemplate(ctx: Ctx, raw: z.input<typeof templateSchema>) {
  assertCan(ctx, "hr.configure");
  const v = templateSchema.parse(raw);
  const bad = [...new Set([...unknownFields(v.subject, v.type), ...unknownFields(v.body, v.type)])];
  if (bad.length)
    throw new BusinessError(`A ${LETTER_LABELS[v.type].toLowerCase()} can't use ${bad.map((b) => `{{${b}}}`).join(", ")} — those fields aren't available for this kind of letter.`);
  await ensureTemplates(ctx.orgId);
  const old = await db.letterTemplate.findUniqueOrThrow({ where: { organizationId_type: { organizationId: ctx.orgId, type: v.type } } });
  const t = await db.letterTemplate.update({
    where: { id: old.id },
    data: { subject: v.subject, body: v.body, signatoryName: v.signatoryName, signatoryTitle: v.signatoryTitle, updatedBy: ctx.name },
  });
  await logAudit(ctx, { action: "LETTER_TEMPLATE_UPDATE", entity: "LetterTemplate", entityId: t.id, oldValue: old, newValue: t });
  return t;
}

export async function resetTemplate(ctx: Ctx, type: LetterTypeKey) {
  assertCan(ctx, "hr.configure");
  const d = DEFAULT_TEMPLATES[type];
  await ensureTemplates(ctx.orgId);
  const old = await db.letterTemplate.findUniqueOrThrow({ where: { organizationId_type: { organizationId: ctx.orgId, type } } });
  const t = await db.letterTemplate.update({
    where: { id: old.id },
    data: { subject: d.subject, body: d.body, signatoryTitle: d.signatoryTitle, signatoryName: "", updatedBy: ctx.name },
  });
  await logAudit(ctx, { action: "LETTER_TEMPLATE_RESET", entity: "LetterTemplate", entityId: t.id, oldValue: old });
  return t;
}

// ───────────────────────────── Generate ─────────────────────────────

export const generateSchema = z.object({
  type: z.enum(LETTER_TYPES),
  employeeId: z.string().optional(),
  offerId: z.string().optional(),
  exitRecordId: z.string().optional(),
  disciplinaryId: z.string().optional(),
});

interface Built {
  recipient: string;
  employeeId?: string;
  candidateId?: string;
  sourceId?: string;
  vars: Record<string, string>;
}

async function employeeVars(ctx: Ctx, employeeId: string) {
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, include: { department: true, category: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  const contracts = await db.employmentContract.findMany({ where: { organizationId: ctx.orgId, employeeId }, orderBy: [{ status: "asc" }, { startDate: "desc" }] });
  const contract = contracts.find((c) => c.status === "ACTIVE") ?? [...contracts].sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
  const name = fullName(emp);
  return {
    emp,
    contracts,
    contract,
    name,
    vars: {
      recipient: name,
      employeeNumber: emp.employeeNumber,
      jobTitle: contract?.jobTitle ?? emp.category.name,
      department: emp.department?.name ?? "",
      category: emp.category.name,
      startDate: fmtDate(emp.employmentDate),
    } as Record<string, string>,
  };
}

async function build(ctx: Ctx, v: z.output<typeof generateSchema>): Promise<Built> {
  const need = (id: string | undefined, what: string) => {
    if (!id) throw new BusinessError(`Choose the ${what} this letter is for.`);
    return id;
  };

  switch (v.type) {
    case "OFFER": {
      const offer = await db.jobOffer.findFirst({
        where: { id: need(v.offerId, "offer"), organizationId: ctx.orgId },
        include: { candidate: true },
      });
      if (!offer) throw new BusinessError("Offer not found.");
      if (!["APPROVED", "SENT", "ACCEPTED"].includes(offer.status))
        throw new BusinessError(`This offer is ${lower(offer.status)} — a letter can only be produced once it has been approved.`);
      const name = `${offer.candidate.firstName} ${offer.candidate.lastName}`;
      return {
        recipient: name,
        candidateId: offer.candidateId,
        sourceId: offer.id,
        vars: {
          recipient: name,
          jobTitle: offer.jobTitle,
          employmentType: lower(offer.employmentType),
          monthlyGross: naira(offer.monthlyGross),
          startDate: fmtDate(offer.startDate),
          validUntil: fmtDate(offer.validUntil),
          probationText: offer.probationMonths > 0 ? `You will serve a probation period of ${offer.probationMonths} month(s).` : "There is no probation period.",
          noticeDays: String(offer.noticePeriodDays),
        },
      };
    }
    case "EMPLOYMENT_CONFIRMATION": {
      const e = await employeeVars(ctx, need(v.employeeId, "employee"));
      if (GONE.includes(e.emp.status)) throw new BusinessError(`${e.emp.employeeNumber} has left — issue an experience letter instead.`);
      return { recipient: e.name, employeeId: e.emp.id, vars: { ...e.vars, contractType: e.contract ? lower(e.contract.type) : "" } };
    }
    case "PROBATION_CONFIRMATION": {
      const e = await employeeVars(ctx, need(v.employeeId, "employee"));
      const confirmed = e.contracts.find((c) => c.probationOutcome === "CONFIRMED");
      if (!confirmed) throw new BusinessError(`${e.emp.employeeNumber} has no confirmed probation on record — confirm it on the contract first.`);
      return { recipient: e.name, employeeId: e.emp.id, sourceId: confirmed.id, vars: { ...e.vars, probationEndDate: fmtDate(confirmed.probationEndDate) } };
    }
    case "WARNING": {
      const rec = await db.disciplinaryRecord.findFirst({ where: { id: need(v.disciplinaryId, "disciplinary record"), organizationId: ctx.orgId } });
      if (!rec) throw new BusinessError("Disciplinary record not found.");
      if (rec.type === "COMMENDATION") throw new BusinessError("A commendation isn't a warning.");
      if (rec.status !== "APPROVED") throw new BusinessError(`This record is ${lower(rec.status)} — a warning letter can only follow a signed-off record.`);
      const e = await employeeVars(ctx, rec.employeeId);
      return {
        recipient: e.name,
        employeeId: e.emp.id,
        sourceId: rec.id,
        vars: { ...e.vars, warningType: lower(rec.type), incidentDate: fmtDate(rec.incidentDate), description: rec.description, actionTaken: rec.actionTaken ?? "" },
      };
    }
    case "EXIT_LETTER":
    case "CLEARANCE_CERTIFICATE": {
      const exit = await db.exitRecord.findFirst({ where: { id: need(v.exitRecordId, "exit"), organizationId: ctx.orgId }, include: { tasks: true } });
      if (!exit) throw new BusinessError("Exit record not found.");
      if (exit.status !== "APPROVED") throw new BusinessError(`This exit is ${lower(exit.status)} — a letter can only be produced once it has been approved.`);
      const e = await employeeVars(ctx, exit.employeeId);
      if (v.type === "EXIT_LETTER")
        return {
          recipient: e.name,
          employeeId: e.emp.id,
          sourceId: exit.id,
          vars: { ...e.vars, exitType: lower(exit.exitType), noticeDate: fmtDate(exit.noticeDate), lastWorkingDate: fmtDate(exit.lastWorkingDate) },
        };
      const open = exit.tasks.filter((t) => t.status === "PENDING" && t.mandatory);
      if (open.length) throw new BusinessError(`Clearance isn't finished — still outstanding: ${open.map((t) => t.taskName).join("; ")}.`);
      const done = exit.tasks.map((t) => t.completedAt).filter((x): x is Date => Boolean(x));
      const clearedOn = done.length ? new Date(Math.max(...done.map((x) => x.getTime()))) : todayUtc();
      return {
        recipient: e.name,
        employeeId: e.emp.id,
        sourceId: exit.id,
        vars: { ...e.vars, lastWorkingDate: fmtDate(exit.lastWorkingDate), clearanceDate: fmtDate(clearedOn) },
      };
    }
    case "EXPERIENCE": {
      const e = await employeeVars(ctx, need(v.employeeId, "employee"));
      if (!GONE.includes(e.emp.status) || !e.emp.exitDate) throw new BusinessError(`${e.emp.employeeNumber} hasn't left — use an employment confirmation instead.`);
      return {
        recipient: e.name,
        employeeId: e.emp.id,
        vars: { ...e.vars, endDate: fmtDate(e.emp.exitDate), serviceLength: serviceLength(e.emp.employmentDate, e.emp.exitDate) },
      };
    }
  }
}

export async function generateLetter(ctx: Ctx, raw: z.input<typeof generateSchema>) {
  assertCan(ctx, "hr.manage");
  const v = generateSchema.parse(raw);
  const built = await build(ctx, v);
  await ensureTemplates(ctx.orgId);
  const [tpl, org] = await Promise.all([
    db.letterTemplate.findUniqueOrThrow({ where: { organizationId_type: { organizationId: ctx.orgId, type: v.type } } }),
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } }),
  ]);
  const vars = { organization: org.name, today: fmtDate(todayUtc()), ...built.vars };
  return db.$transaction(async (tx) => {
    const referenceNumber = await nextNumber(tx, ctx.orgId, "LETTER");
    const letter = await tx.generatedLetter.create({
      data: {
        organizationId: ctx.orgId,
        referenceNumber,
        type: v.type,
        recipientName: built.recipient,
        employeeId: built.employeeId ?? null,
        candidateId: built.candidateId ?? null,
        sourceId: built.sourceId ?? null,
        subject: renderTemplate(tpl.subject, vars),
        body: renderTemplate(tpl.body, vars),
        signatoryName: tpl.signatoryName,
        signatoryTitle: tpl.signatoryTitle,
        generatedBy: ctx.name,
      },
    });
    await logAudit(
      ctx,
      {
        action: "LETTER_GENERATE",
        entity: built.employeeId ? "Employee" : "Candidate",
        entityId: built.employeeId ?? built.candidateId ?? null,
        newValue: { reference: referenceNumber, type: v.type, recipient: built.recipient },
      },
      tx,
    );
    return letter;
  });
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listLetters(ctx: Ctx, f: { employeeId?: string; type?: string; q?: string } = {}) {
  assertCan(ctx, "hr.view");
  return db.generatedLetter.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
      ...(f.type ? { type: f.type as never } : {}),
      ...(f.q ? { OR: [{ recipientName: { contains: f.q, mode: "insensitive" } }, { referenceNumber: { contains: f.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function getLetter(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  const l = await db.generatedLetter.findFirst({ where: { id, organizationId: ctx.orgId }, include: { organization: { select: { name: true, address: true } } } });
  return l;
}
