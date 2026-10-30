/**
 * The rules of the automation engine that need no database: whether a condition holds (the monthly value compared exactly, in kobo), what a message template says,
 * what settings each action needs, and which pairs of trigger and action make sense. The service (src/server/services/sales/automation.ts) uses these and nothing else
 * to decide.
 */
import { z } from "zod";
import { parseNairaAmount } from "./money";

// ─────────────────────────────── conditions ───────────────────────────────

export const CONDITION_FIELDS = ["monthlyContractValue", "probability", "source", "serviceType"] as const;
export const OPS = [">", ">=", "<", "<=", "=", "!="] as const;
export const conditionSchema = z.object({ field: z.enum(CONDITION_FIELDS), op: z.enum(OPS), value: z.union([z.string(), z.number()]) });
export type Condition = z.infer<typeof conditionSchema>;
export interface DealFacts {
  monthlyContractValue: string | number | { toString(): string };
  probability: number;
  source: string | null;
  serviceType: string;
}

const LABEL = { monthlyContractValue: "Monthly value", probability: "Probability", source: "Source", serviceType: "Service" } as const;
const PHRASE: Record<(typeof OPS)[number], [string, string]> = { ">": ["is above", "is not above"], ">=": ["is at least", "is not at least"], "<": ["is below", "is not below"], "<=": ["is at most", "is not at most"], "=": ["is equal to", "is not equal to"], "!=": ["is not equal to", "is equal to"] };
const WORD: Record<(typeof OPS)[number], string> = { ">": "above", ">=": "at least", "<": "below", "<=": "at most", "=": "equal to", "!=": "not equal to" };

const naira = (s: string) => `₦${Number(s).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Whole kobo from a two-decimal naira string, exactly. */
const kobo = (s: string) => BigInt(s.replace(".", ""));
const amount = (v: string | number | { toString(): string }, what: string) => {
  try {
    return parseNairaAmount(typeof v === "number" ? v : String(v), what);
  } catch (e) {
    throw new Error((e as Error).message);
  }
};
const cmp = (a: bigint | number, b: bigint | number, op: (typeof OPS)[number]) => (op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : op === "<=" ? a <= b : op === "=" ? a === b : a !== b);

/** Whether the condition holds for a deal, and a sentence saying so. The monthly value is compared in whole kobo. */
export function evaluateCondition(c: Condition, f: DealFacts): { met: boolean; detail: string } {
  let met: boolean;
  let shown: string;
  let wanted: string;
  if (c.field === "monthlyContractValue") {
    const have = amount(f.monthlyContractValue, "The deal's value");
    const want = amount(c.value, "The amount in the condition");
    met = cmp(kobo(have), kobo(want), c.op);
    [shown, wanted] = [naira(have), naira(want)];
  } else if (c.field === "probability") {
    const want = Number(c.value);
    if (!Number.isFinite(want)) throw new Error("The probability in the condition is not a number.");
    met = cmp(f.probability, want, c.op);
    [shown, wanted] = [`${f.probability}%`, `${want}%`];
  } else {
    if (c.op !== "=" && c.op !== "!=") throw new Error("A source or service can only be compared as equal or not equal.");
    const have = (c.field === "source" ? f.source : f.serviceType)?.toString().toUpperCase() ?? "";
    const want = String(c.value).trim().toUpperCase();
    met = c.op === "=" ? have === want : have !== want;
    [shown, wanted] = [have || "not set", want];
  }
  return { met, detail: `${LABEL[c.field]} ${shown} ${PHRASE[c.op][met ? 0 : 1]} ${wanted}` };
}

export function describeCondition(c: Condition | null | undefined): string {
  if (!c) return "always";
  const v = c.field === "monthlyContractValue" ? naira(amount(c.value, "The amount in the condition")) : c.field === "probability" ? `${c.value}%` : String(c.value);
  return `${LABEL[c.field].toLowerCase()} is ${WORD[c.op]} ${v}`;
}

// ─────────────────────────────── templates ───────────────────────────────

export const TEMPLATE_VARS = ["contactFirstName", "dealName", "company", "ownerName"] as const;
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (_m, k: string) => vars[k] ?? "");
}
export function unknownPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((k) => !(TEMPLATE_VARS as readonly string[]).includes(k));
}
const template = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `${label} is too short`)
    .max(max)
    .superRefine((t, ctx) => {
      const bad = unknownPlaceholders(t);
      if (bad.length) ctx.addIssue({ code: "custom", message: `${label} uses {{${bad[0]}}}, which is not available. Use ${TEMPLATE_VARS.map((v) => `{{${v}}}`).join(", ")}.` });
    });

// ─────────────────────────────── actions ───────────────────────────────

export const ACTIONS = ["CREATE_TASK", "NOTIFY", "SEND_EMAIL", "CHANGE_OWNER", "SET_FIELD", "CREATE_FOLLOW_UP", "MOVE_TO_STAGE"] as const;
export type ActionType = (typeof ACTIONS)[number];

const schemas = {
  CREATE_TASK: z
    .object({
      title: template("The task title", 2, 200),
      dueInHours: z.number().int("Hours must be a whole number").min(1, "A task is due in at least 1 hour").max(8760, "A task cannot be due more than a year ahead"),
      assignee: z.enum(["OWNER", "USER"]),
      userId: z.string().optional(),
      notes: template("The task notes", 0, 2000).optional(),
    })
    .refine((v) => v.assignee !== "USER" || !!v.userId, { message: "Choose who the task is for" }),
  NOTIFY: z
    .object({ to: z.enum(["OWNER", "MANAGERS", "OPERATIONS", "USER"]), userId: z.string().optional(), subject: template("The subject", 2, 200), message: template("The message", 2, 2000) })
    .refine((v) => v.to !== "USER" || !!v.userId, { message: "Choose who to tell" }),
  SEND_EMAIL: z.object({ purpose: z.enum(["SERVICE", "MARKETING"]), subject: template("The subject", 2, 200), body: template("The message", 2, 4000) }),
  CHANGE_OWNER: z.object({ userId: z.string().min(1, "Choose the new owner") }),
  SET_FIELD: z
    .object({ field: z.enum(["nextStep", "probability", "competitor"]), value: z.string().trim().min(1, "Give the value").max(300) })
    .refine((v) => v.field !== "probability" || (/^\d{1,3}$/.test(v.value) && Number(v.value) <= 100), { message: "A probability is a whole number between 0 and 100" }),
  CREATE_FOLLOW_UP: z.object({ pipelineId: z.string().min(1, "Choose the pipeline"), name: template("The deal name", 2, 200) }),
  MOVE_TO_STAGE: z.object({ stageId: z.string().min(1, "Choose the stage") }),
} as const;

/** The settings of an action, checked; the message of the first problem is thrown. */
export function parseAction<T extends ActionType>(type: T, params: unknown): z.infer<(typeof schemas)[T]> {
  const r = schemas[type].safeParse(params);
  if (!r.success) throw new Error(r.error.issues[0].message);
  return r.data as z.infer<(typeof schemas)[T]>;
}

const MAX_DELAY_MINUTES = 60 * 24 * 365;

/** A sentence about what is wrong with the shape of a rule, or null if it makes sense. */
export function ruleShapeProblem(r: { trigger: string; stageId?: string | null; quietDays?: number | null; actionType: string; delayMinutes: number }): string | null {
  if (!Number.isInteger(r.delayMinutes) || r.delayMinutes < 0 || r.delayMinutes > MAX_DELAY_MINUTES) return "The delay must be between 0 minutes and a year.";
  if (r.trigger === "STAGE_ENTRY") {
    if (!r.stageId) return "A stage-entry rule needs the stage it is about.";
    if (r.actionType === "MOVE_TO_STAGE") return "Only an event (a quote or handover being accepted) moves a deal; a rule that fires on entering a stage may not, because it could loop.";
  }
  if (r.trigger === "QUOTE_ACCEPTED" || r.trigger === "HANDOVER_ACCEPTED") {
    if (r.stageId) return "An event rule does not name a stage to watch; it names the stage to move to in its action.";
  }
  if (r.trigger === "NO_ACTIVITY") {
    if (!r.quietDays || r.quietDays < 1 || r.quietDays > 365) return "A no-activity rule needs the number of quiet days (1 to 365).";
    if (r.actionType === "MOVE_TO_STAGE") return "A no-activity rule only tells people; it does not move the deal.";
  }
  if (r.actionType === "MOVE_TO_STAGE" && r.trigger !== "QUOTE_ACCEPTED" && r.trigger !== "HANDOVER_ACCEPTED") return "Only a quote or handover being accepted can move a deal.";
  return null;
}
