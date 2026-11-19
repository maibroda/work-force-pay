"use server";
import { actFor } from "./_run";
import * as hp from "@/server/services/hourly-pay";
const act = actFor("hourly-pay.ts");

type V = Record<string, unknown>;
const PATHS = ["/payroll/hourly-pay", "/payroll/holidays"];
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** A company administrator switches hourly pay on or off for the company. */
export async function setHourlyPayAction(enabled: boolean) {
  return act("settings.manage", async (ctx) => {
    await hp.setHourlyPayEnabled(ctx, enabled);
    return { message: enabled ? "Hourly pay is switched on." : "Hourly pay is switched off. Nothing already agreed is deleted." };
  }, PATHS);
}

/** The payroll people propose an hourly rate; a second person (the payroll manager) must approve it before it counts. */
export async function proposeHourlyRateAction(v: V) {
  return act("payroll.run", async (ctx) => {
    await hp.proposeHourlyRate(ctx, {
      scope: text(v.scope),
      employeeId: text(v.employeeId),
      contractId: text(v.contractId),
      categoryId: text(v.categoryId),
      weekdayRate: text(v.weekdayRate),
      weekendRate: text(v.weekendRate),
      holidayRate: text(v.holidayRate),
      effectiveFrom: text(v.effectiveFrom),
      reason: text(v.reason),
    });
    return { message: "Proposed. It counts only when a payroll manager approves it." };
  }, PATHS);
}

export async function approveHourlyRateAction(id: string) {
  return act("payrate.approve", async (ctx) => {
    await hp.approveHourlyRate(ctx, id);
    return { message: "Approved: the rate applies from its date." };
  }, PATHS);
}

export async function rejectHourlyRateAction(id: string, reason?: string) {
  return act("payrate.approve", async (ctx) => {
    await hp.rejectHourlyRate(ctx, id, reason ?? "");
    return { message: "Proposal rejected." };
  }, PATHS);
}

export async function cancelHourlyRateAction(id: string) {
  return act("payroll.run", async (ctx) => {
    await hp.cancelHourlyRate(ctx, id);
    return { message: "Proposal withdrawn." };
  }, PATHS);
}

export async function proposeCompensationTypeAction(v: V) {
  return act("payroll.run", async (ctx) => {
    await hp.proposeCompensationType(ctx, { employeeId: text(v.employeeId), type: text(v.type), effectiveFrom: text(v.effectiveFrom), reason: text(v.reason) });
    return { message: "Proposed. It counts only when a payroll manager approves it." };
  }, PATHS);
}

export async function approveCompensationTypeAction(id: string) {
  return act("payrate.approve", async (ctx) => {
    await hp.approveCompensationType(ctx, id);
    return { message: "Approved: it applies from its date." };
  }, PATHS);
}

export async function rejectCompensationTypeAction(id: string, reason?: string) {
  return act("payrate.approve", async (ctx) => {
    await hp.rejectCompensationType(ctx, id, reason ?? "");
    return { message: "Proposal rejected." };
  }, PATHS);
}

export async function cancelCompensationTypeAction(id: string) {
  return act("payroll.run", async (ctx) => {
    await hp.cancelCompensationType(ctx, id);
    return { message: "Proposal withdrawn." };
  }, PATHS);
}

/** Limits a public holiday to states (a comma-separated list of state names); empty makes it national again. */
export async function setHolidayStatesAction(v: V) {
  return act("payroll.run", async (ctx) => {
    const states = text(v.states)
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    await hp.setHolidayStates(ctx, text(v.holidayId), states);
    return { message: states.length ? "The holiday now applies only in those states. Its year needs confirming again." : "The holiday is national again. Its year needs confirming again." };
  }, PATHS);
}
