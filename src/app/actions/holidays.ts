"use server";
import { actFor } from "./_run";
import * as hol from "@/server/services/holidays";
const act = actFor("holidays.ts");

type V = Record<string, unknown>;
const PATHS = ["/payroll/holidays"];

export async function addHolidayAction(v: V) {
  return act("payroll.run", async (ctx) => {
    await hol.addHoliday(ctx, { date: String(v.date ?? ""), name: String(v.name ?? "") });
    return { message: "Holiday added. Its year needs confirming again." };
  }, PATHS);
}

export async function removeHolidayAction(id: string) {
  return act("payroll.run", async (ctx) => {
    await hol.removeHoliday(ctx, id);
    return { message: "Holiday removed. Its year needs confirming again." };
  }, PATHS);
}

export async function confirmHolidayYearAction(year: number) {
  return act("payrate.approve", async (ctx) => {
    await hol.confirmHolidayYear(ctx, year);
    return { message: `The holidays for ${year} are confirmed.` };
  }, PATHS);
}
