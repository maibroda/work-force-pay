"use server";
import { act } from "./_run";
import * as bankRec from "@/server/services/bank-reconciliation";

type V = Record<string, unknown>;
const PATHS = ["/finance/bank-accounts", "/finance/bank-reconciliation"];

export async function createBankAccountAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const acct = await bankRec.createBankAccount(ctx, v as never);
      return { message: `Bank account "${acct.name}" created.` };
    },
    PATHS,
  );
}

export async function setBankAccountActiveAction(id: string, active: boolean) {
  return act(
    "payment.manage",
    async (ctx) => {
      await bankRec.setBankAccountActive(ctx, id, active);
      return { message: active ? "Bank account reactivated." : "Bank account deactivated." };
    },
    PATHS,
  );
}

export async function importStatementLinesAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const r = await bankRec.importStatementLines(ctx, String(v.bankAccountId), String(v.csv ?? ""));
      return { message: `Imported ${r.imported} line(s) — ${r.matched} auto-matched, ${r.remaining} left for review.` };
    },
    PATHS,
  );
}

export async function autoMatchStatementLinesAction(bankAccountId: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      const r = await bankRec.autoMatchStatementLines(ctx, bankAccountId);
      return { message: `${r.matched} matched, ${r.remaining} still need review.` };
    },
    PATHS,
  );
}

export async function manualMatchStatementLineAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await bankRec.manualMatchStatementLine(
        ctx,
        String(v.lineId),
        v.kind as "CLIENT_RECEIPT" | "VENDOR_PAYMENT",
        String(v.targetId),
      );
      return { message: "Statement line matched." };
    },
    PATHS,
  );
}

export async function markStatementLineManualAction(lineId: string, note?: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await bankRec.markStatementLineManual(ctx, lineId, note ?? "");
      return { message: "Marked as a bank-only item." };
    },
    PATHS,
  );
}

export async function unmatchStatementLineAction(lineId: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await bankRec.unmatchStatementLine(ctx, lineId);
      return { message: "Match removed." };
    },
    PATHS,
  );
}
