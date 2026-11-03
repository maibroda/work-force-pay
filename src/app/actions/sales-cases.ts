"use server";
import { act } from "./_run";
import { addCaseNote, addHoliday, createCase, createStarterPolicies, reassignCase, removeHoliday, removeSlaPolicy, reopenCase, resolveCase, respondToCase, saveBusinessHours, saveSlaPolicy, setRenewalWindow } from "@/server/services/sales/cases";

type V = Record<string, unknown>;
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Number(x));
const minutes = (x: unknown) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(x ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const CASES = ["/sales/cases"];

export async function createCaseAction(v: V) {
  return act("sales.case.manage", async (ctx) => {
    const c = await createCase(ctx, { accountId: String(v.accountId ?? ""), contactId: text(v.contactId), category: String(v.category ?? "") as never, priority: String(v.priority ?? "") as never, subject: String(v.subject ?? ""), description: text(v.description) });
    return { message: `Case ${c.number} opened.`, data: { id: c.id } };
  }, CASES);
}
export async function respondToCaseAction(v: V) {
  return act("sales.case.manage", async (ctx) => {
    await respondToCase(ctx, String(v.id ?? ""), String(v.note ?? ""));
    return { message: "Answer recorded." };
  }, CASES);
}
export async function addCaseNoteAction(v: V) {
  return act("sales.case.manage", async (ctx) => {
    await addCaseNote(ctx, String(v.id ?? ""), String(v.note ?? ""));
    return { message: "Note added." };
  }, CASES);
}
export async function resolveCaseAction(v: V) {
  return act("sales.case.manage", async (ctx) => {
    await resolveCase(ctx, String(v.id ?? ""), String(v.note ?? ""));
    return { message: "Case resolved." };
  }, CASES);
}
export async function reopenCaseAction(v: V) {
  return act("sales.case.manage", async (ctx) => {
    await reopenCase(ctx, String(v.id ?? ""), String(v.note ?? ""));
    return { message: "Case reopened. Its resolution clock has restarted." };
  }, CASES);
}
export async function reassignCaseAction(v: V) {
  return act("sales.case.manage", async (ctx) => {
    await reassignCase(ctx, String(v.id ?? ""), String(v.userId ?? ""));
    return { message: "Case reassigned." };
  }, CASES);
}

export async function saveBusinessHoursAction(v: V) {
  return act("sales.configure", async (ctx) => {
    const open = minutes(v.open);
    const close = minutes(v.close);
    if (Number.isNaN(open) || Number.isNaN(close)) throw new (await import("@/server/services/_base")).BusinessError("Give the times like 08:00 and 17:00.");
    await saveBusinessHours(ctx, { openMinute: open, closeMinute: close, workDays: [1, 2, 3, 4, 5, 6, 7].filter((d, i) => v[["mon", "tue", "wed", "thu", "fri", "sat", "sun"][i]] === true) });
    return { message: "Business hours saved. Cases already open keep the deadlines they were given." };
  }, ["/sales/cases/settings"]);
}
export async function addHolidayAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await addHoliday(ctx, { date: String(v.date ?? ""), name: String(v.name ?? "") });
    return { message: "Holiday added." };
  }, ["/sales/cases/settings"]);
}
export async function removeHolidayAction(id: string) {
  return act("sales.configure", async (ctx) => {
    await removeHoliday(ctx, id);
    return { message: "Holiday removed." };
  }, ["/sales/cases/settings"]);
}
export async function saveSlaPolicyAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await saveSlaPolicy(ctx, { accountId: text(v.accountId), priority: String(v.priority ?? "") as never, firstResponseMinutes: Number(num(v.firstResponseHours) ?? NaN) * 60, resolutionMinutes: Number(num(v.resolutionHours) ?? NaN) * 60, businessHoursOnly: v.businessHoursOnly === true });
    return { message: "Policy saved. It applies to cases opened from now on." };
  }, ["/sales/cases/settings"]);
}
export async function removeSlaPolicyAction(id: string) {
  return act("sales.configure", async (ctx) => {
    await removeSlaPolicy(ctx, id);
    return { message: "Policy removed." };
  }, ["/sales/cases/settings"]);
}
export async function starterPoliciesAction() {
  return act("sales.configure", async (ctx) => {
    await createStarterPolicies(ctx);
    return { message: "Starting policies made. They are placeholders: correct them." };
  }, ["/sales/cases/settings"]);
}
export async function setRenewalWindowAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await setRenewalWindow(ctx, Number(v.days));
    return { message: "Renewal window saved." };
  }, ["/sales/cases/settings"]);
}
