import type { Ctx } from "@/lib/auth/context";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

export function formatNumber(rule: { prefix: string; separator: string; digits: number }, n: number) {
  const body = String(n).padStart(rule.digits, "0");
  return rule.prefix ? `${rule.prefix}${rule.separator}${body}` : body;
}

const DEFAULTS: Record<string, { prefix: string; digits: number }> = {
  EMPLOYEE: { prefix: "EMP", digits: 6 },
  CLIENT: { prefix: "CLT", digits: 4 },
  CONTRACT: { prefix: "CON", digits: 5 },
  BEAT: { prefix: "BT", digits: 5 },
  PAYMENT_BATCH: { prefix: "PAY", digits: 6 },
  JOURNAL: { prefix: "JV", digits: 6 },
  INVOICE: { prefix: "INV", digits: 6 },
  PURCHASE_INVOICE: { prefix: "PINV", digits: 6 },
  PURCHASE_ORDER: { prefix: "PO", digits: 6 },
  FIXED_ASSET: { prefix: "FA", digits: 6 },
  EMPLOYMENT_CONTRACT: { prefix: "EC", digits: 6 },
  REQUISITION: { prefix: "REQ", digits: 5 },
  CANDIDATE: { prefix: "CAN", digits: 6 },
  JOB_OFFER: { prefix: "OFR", digits: 5 },
  RELATIONS_CASE: { prefix: "ER", digits: 5 },
  SETTLEMENT: { prefix: "EOS", digits: 5 },
  INVENTORY_ITEM: { prefix: "ITM", digits: 5 },
  LOAN: { prefix: "LN", digits: 5 },
  LETTER: { prefix: "LET", digits: 5 },
  DATA_REQUEST: { prefix: "DSR", digits: 5 },
};

/**
 * Atomically reserve the next number for an entity. The UPDATE ... increment runs inside the
 * caller's transaction, so concurrent creations never receive the same number; a DB unique
 * constraint on (organizationId, employeeNumber) is the final guard.
 */
export async function nextNumber(tx: Tx, orgId: string, entity: string): Promise<string> {
  const existing = await tx.numberingRule.findUnique({
    where: { organizationId_entity: { organizationId: orgId, entity } },
  });
  if (!existing) {
    const def = DEFAULTS[entity] ?? { prefix: entity.slice(0, 3), digits: 6 };
    await tx.numberingRule.create({
      data: { organizationId: orgId, entity, prefix: def.prefix, digits: def.digits, nextNumber: 1 },
    });
  }
  const rule = await tx.numberingRule.update({
    where: { organizationId_entity: { organizationId: orgId, entity } },
    data: { nextNumber: { increment: 1 } },
  });
  return formatNumber(rule, rule.nextNumber - 1);
}

export async function previewNextNumber(ctx: Ctx, entity: string) {
  const rule = await db.numberingRule.findUnique({
    where: { organizationId_entity: { organizationId: ctx.orgId, entity } },
  });
  if (!rule) {
    const def = DEFAULTS[entity];
    return formatNumber({ prefix: def?.prefix ?? "", separator: "-", digits: def?.digits ?? 6 }, 1);
  }
  return formatNumber(rule, rule.nextNumber);
}

export async function listNumberingRules(ctx: Ctx) {
  return db.numberingRule.findMany({ where: { organizationId: ctx.orgId }, orderBy: { entity: "asc" } });
}

export async function updateNumberingRule(
  ctx: Ctx,
  input: { entity: string; prefix: string; separator: string; digits: number; nextNumber: number },
) {
  assertCan(ctx, "settings.manage");
  if (input.digits < 1 || input.digits > 12) throw new BusinessError("Digits must be between 1 and 12.");
  return db.$transaction(async (tx) => {
    const old = await tx.numberingRule.findUnique({
      where: { organizationId_entity: { organizationId: ctx.orgId, entity: input.entity } },
    });
    if (input.entity === "EMPLOYEE") {
      // Never allow the sequence to point at a number that already exists.
      const candidate = formatNumber(input, input.nextNumber);
      const clash = await tx.employee.findFirst({
        where: { organizationId: ctx.orgId, employeeNumber: candidate },
      });
      if (clash)
        throw new BusinessError(`Employee number ${candidate} already exists — choose a higher next number.`);
    }
    const rule = await tx.numberingRule.upsert({
      where: { organizationId_entity: { organizationId: ctx.orgId, entity: input.entity } },
      create: { organizationId: ctx.orgId, ...input },
      update: {
        prefix: input.prefix,
        separator: input.separator,
        digits: input.digits,
        nextNumber: input.nextNumber,
      },
    });
    await logAudit(
      ctx,
      {
        action: "NUMBERING_RULE_UPDATE",
        entity: "NumberingRule",
        entityId: rule.id,
        oldValue: old,
        newValue: rule,
      },
      tx,
    );
    return rule;
  });
}
