import { describe, expect, it } from "vitest";
import { evaluateCondition, parseAction, renderTemplate, ruleShapeProblem, unknownPlaceholders, describeCondition } from "@/lib/sales/automation";

const facts = (o: Partial<Parameters<typeof evaluateCondition>[1]> = {}) => ({ monthlyContractValue: "6000000.00", probability: 50, source: "TENDER", serviceType: "GUARDING", ...o });

describe("conditions", () => {
  it("compares the monthly value exactly, in kobo, never as a floating-point number", () => {
    const above = { field: "monthlyContractValue", op: ">", value: "5000000" } as const;
    expect(evaluateCondition(above, facts()).met).toBe(true);
    expect(evaluateCondition(above, facts({ monthlyContractValue: "5000000.00" })).met).toBe(false); // equal is not above
    expect(evaluateCondition(above, facts({ monthlyContractValue: "5000000.01" })).met).toBe(true); // one kobo above
    expect(evaluateCondition({ field: "monthlyContractValue", op: ">=", value: "5000000" }, facts({ monthlyContractValue: "5000000.00" })).met).toBe(true);
    expect(evaluateCondition({ field: "monthlyContractValue", op: "<", value: "0.10" }, facts({ monthlyContractValue: "0.30" })).met).toBe(false);
    expect(evaluateCondition({ field: "monthlyContractValue", op: "=", value: "0.30" }, facts({ monthlyContractValue: "0.30" })).met).toBe(true); // 0.1 + 0.2 style trouble cannot arise
    expect(evaluateCondition(above, facts({ monthlyContractValue: { toString: () => "7500000.50" } as never })).met).toBe(true); // a database decimal
  });

  it("compares the probability as a number, and the source and service as words (equal or not equal, ignoring case)", () => {
    expect(evaluateCondition({ field: "probability", op: ">=", value: 50 }, facts()).met).toBe(true);
    expect(evaluateCondition({ field: "probability", op: "<", value: 50 }, facts()).met).toBe(false);
    expect(evaluateCondition({ field: "source", op: "=", value: "tender" }, facts()).met).toBe(true);
    expect(evaluateCondition({ field: "source", op: "!=", value: "REFERRAL" }, facts()).met).toBe(true);
    expect(evaluateCondition({ field: "source", op: "=", value: "REFERRAL" }, facts({ source: null })).met).toBe(false);
    expect(evaluateCondition({ field: "serviceType", op: "=", value: "GUARDING" }, facts()).met).toBe(true);
  });

  it("refuses a comparison that makes no sense, and says in words why it held or did not", () => {
    expect(() => evaluateCondition({ field: "source", op: ">", value: "TENDER" }, facts())).toThrow(/equal or not equal/i);
    expect(() => evaluateCondition({ field: "monthlyContractValue", op: ">", value: "lots" }, facts())).toThrow(/amount/i);
    const r = evaluateCondition({ field: "monthlyContractValue", op: ">", value: "5000000" }, facts());
    expect(r.detail).toBe("Monthly value ₦6,000,000.00 is above ₦5,000,000.00");
    expect(evaluateCondition({ field: "monthlyContractValue", op: ">", value: "9000000" }, facts()).detail).toBe("Monthly value ₦6,000,000.00 is not above ₦9,000,000.00");
    expect(describeCondition({ field: "monthlyContractValue", op: ">", value: "5000000" })).toBe("monthly value is above ₦5,000,000.00");
    expect(describeCondition(null)).toBe("always");
  });
});

describe("templates", () => {
  it("fills in the name, deal, company and owner, and knows which placeholders are allowed", () => {
    const vars = { contactFirstName: "Funmi", dealName: "24/7 guarding", company: "Lekki Gardens", ownerName: "Adaeze" };
    expect(renderTemplate("Hello {{contactFirstName}}, about {{ dealName }} for {{company}}. {{ownerName}}", vars)).toBe("Hello Funmi, about 24/7 guarding for Lekki Gardens. Adaeze");
    expect(renderTemplate("No placeholders", vars)).toBe("No placeholders");
    expect(unknownPlaceholders("Hi {{contactFirstName}} {{salary}} {{ password }}")).toEqual(["salary", "password"]);
    expect(unknownPlaceholders("Hi {{company}}")).toEqual([]);
  });
});

describe("what a rule may be", () => {
  it("checks each action's settings", () => {
    expect(parseAction("CREATE_TASK", { title: "Book site survey", dueInHours: 48, assignee: "OWNER" })).toMatchObject({ dueInHours: 48 });
    expect(() => parseAction("CREATE_TASK", { title: "x", dueInHours: 48, assignee: "OWNER" })).toThrow();
    expect(() => parseAction("CREATE_TASK", { title: "Book site survey", dueInHours: 0, assignee: "OWNER" })).toThrow(/at least 1 hour/i);
    expect(() => parseAction("CREATE_TASK", { title: "Book site survey", dueInHours: 48, assignee: "USER" })).toThrow(/who the task is for/i);
    expect(parseAction("NOTIFY", { to: "MANAGERS", subject: "A big deal moved", message: "Look at {{dealName}}" })).toMatchObject({ to: "MANAGERS" });
    expect(() => parseAction("NOTIFY", { to: "USER", subject: "Hello", message: "Hello there" })).toThrow(/who to tell/i);
    expect(() => parseAction("NOTIFY", { to: "OWNER", subject: "Hello", message: "Your pay is {{salary}}" })).toThrow(/salary/);
    expect(parseAction("SEND_EMAIL", { purpose: "SERVICE", subject: "Welcome aboard", body: "Hello {{contactFirstName}}" })).toMatchObject({ purpose: "SERVICE" });
    expect(() => parseAction("SEND_EMAIL", { subject: "Welcome aboard", body: "Hello" })).toThrow();
    expect(parseAction("SET_FIELD", { field: "probability", value: "60" })).toMatchObject({ value: "60" });
    expect(() => parseAction("SET_FIELD", { field: "probability", value: "160" })).toThrow(/0 and 100/);
    expect(() => parseAction("SET_FIELD", { field: "monthlyContractValue", value: "1" })).toThrow();
    expect(() => parseAction("CHANGE_OWNER", {})).toThrow();
  });

  it("allows only sensible pairs of trigger and action, and the settings each trigger needs", () => {
    expect(ruleShapeProblem({ trigger: "STAGE_ENTRY", stageId: "s1", actionType: "CREATE_TASK", delayMinutes: 0 })).toBeNull();
    expect(ruleShapeProblem({ trigger: "STAGE_ENTRY", stageId: null, actionType: "CREATE_TASK", delayMinutes: 0 })).toMatch(/stage/i);
    expect(ruleShapeProblem({ trigger: "STAGE_ENTRY", stageId: "s1", actionType: "MOVE_TO_STAGE", delayMinutes: 0 })).toMatch(/moves a deal/i); // a stage-entry rule may not move a deal (it could loop)
    expect(ruleShapeProblem({ trigger: "QUOTE_ACCEPTED", stageId: null, actionType: "MOVE_TO_STAGE", delayMinutes: 0 })).toBeNull();
    expect(ruleShapeProblem({ trigger: "HANDOVER_ACCEPTED", stageId: null, actionType: "NOTIFY", delayMinutes: 0 })).toBeNull();
    expect(ruleShapeProblem({ trigger: "NO_ACTIVITY", stageId: null, quietDays: 14, actionType: "NOTIFY", delayMinutes: 0 })).toBeNull();
    expect(ruleShapeProblem({ trigger: "NO_ACTIVITY", stageId: null, quietDays: 14, actionType: "MOVE_TO_STAGE", delayMinutes: 0 })).toMatch(/does not move/i);
    expect(ruleShapeProblem({ trigger: "NO_ACTIVITY", stageId: null, quietDays: null, actionType: "NOTIFY", delayMinutes: 0 })).toMatch(/quiet/i);
    expect(ruleShapeProblem({ trigger: "STAGE_ENTRY", stageId: "s1", actionType: "CREATE_TASK", delayMinutes: -1 })).toMatch(/delay/i);
    expect(ruleShapeProblem({ trigger: "STAGE_ENTRY", stageId: "s1", actionType: "CREATE_TASK", delayMinutes: 60 * 24 * 400 })).toMatch(/delay/i);
  });
});
