"use server";
import { act } from "./_run";
import { createRule, markNotificationsRead, setRuleEnabled, testRule } from "@/server/services/sales/automation";

type V = Record<string, unknown>;
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Number(x));

/** Makes a rule from the form. It starts switched off. */
export async function createRuleAction(v: V) {
  return act("sales.configure", async (ctx) => {
    const actionType = String(v.actionType ?? "");
    const params: Record<string, unknown> =
      actionType === "CREATE_TASK" ? { title: text(v.title) ?? "", dueInHours: num(v.dueInHours), assignee: v.assignee === "USER" ? "USER" : "OWNER", userId: text(v.userId) }
      : actionType === "NOTIFY" ? { to: text(v.to), userId: text(v.userId), subject: text(v.subject) ?? "", message: text(v.message) ?? "" }
      : actionType === "SEND_EMAIL" ? { purpose: v.purpose === "MARKETING" ? "MARKETING" : "SERVICE", subject: text(v.subject) ?? "", body: text(v.message) ?? "" }
      : actionType === "CHANGE_OWNER" ? { userId: text(v.userId) ?? "" }
      : actionType === "SET_FIELD" ? { field: text(v.field), value: text(v.value) ?? "" }
      : actionType === "CREATE_FOLLOW_UP" ? { pipelineId: text(v.followPipelineId) ?? "", name: text(v.followName) ?? "" }
      : { stageId: text(v.moveStageId) ?? "" };
    const delayMinutes = (num(v.delayDays) ?? 0) * 1440 + (num(v.delayHours) ?? 0) * 60;
    const cond = text(v.condValue);
    await createRule(ctx, {
      name: String(v.name ?? ""),
      trigger: String(v.trigger ?? "") as never,
      pipelineId: String(v.pipelineId ?? ""),
      stageId: text(v.stageId),
      delayMinutes,
      quietDays: num(v.quietDays),
      condition: cond ? { field: String(v.condField) as never, op: String(v.condOp ?? "=") as never, value: cond } : undefined,
      actionType: actionType as never,
      actionParams: params,
    });
    return { message: "Rule made. It is switched off: switch it on when you are ready." };
  }, ["/sales/automation"]);
}

export async function setRuleEnabledAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await setRuleEnabled(ctx, String(v.id ?? ""), v.enabled === true);
    return { message: v.enabled === true ? "Rule switched on." : "Rule switched off. What was waiting for it is cancelled." };
  }, ["/sales/automation"]);
}

/** What the rule would do for this deal. Changes nothing. */
export async function testRuleAction(v: V) {
  return act("sales.configure", async (ctx) => {
    const r = await testRule(ctx, String(v.ruleId ?? ""), String(v.opportunityId ?? ""));
    return { message: r.wouldRun ? "It would run." : "It would not run.", data: r };
  });
}

export async function markNotificationsReadAction() {
  return act("sales.view", async (ctx) => {
    await markNotificationsRead(ctx);
    return { message: "Marked as read." };
  }, ["/sales/notifications"]);
}
