import { describe, expect, it } from "vitest";
import { isWorkingDay, planReminders, renderClientApproval, renderClientInputs, renderTeamDigest, type MilestoneFact, type PeriodFacts } from "@/lib/payroll-reminders";
import { milestoneState } from "@/lib/payroll-calendar";

const TODAY = "2026-10-21"; // a Wednesday
const dayMs = 86400000;
const shift = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const m = (key: string, label: string, offset: number, done = false): MilestoneFact => ({ key, label, due: shift(offset), done, state: milestoneState(shift(offset), done, TODAY), days: offset });
const facts = (over: Partial<PeriodFacts> = {}, ms?: MilestoneFact[]): PeriodFacts => ({
  periodName: "October 2026", clientName: "Acme Ltd", bureauName: "ThreeRoots Payroll Services", leadDays: 2,
  milestones: ms ?? [m("inputCutoff", "Inputs due from the client", -1), m("draftDue", "Draft payroll due", 2), m("approvalDue", "Client approval due", 4), m("payDate", "Pay date", 7), m("remittanceDue", "Statutory remittances due", 20)],
  outstandingInputs: ["ATTENDANCE", "OVERTIME"],
  ...over,
});

describe("working days", () => {
  it("are Monday to Friday", () => {
    expect(isWorkingDay("2026-10-23")).toBe(true); // Friday
    expect(isWorkingDay("2026-10-24")).toBe(false);
    expect(isWorkingDay("2026-10-25")).toBe(false);
  });
});

describe("what to remind about", () => {
  it("asks the client for outstanding inputs once the cut-off is within the lead time or past, and says it is overdue", () => {
    const p = planReminders(facts());
    const c = p.find((x) => x.kind === "CLIENT_INPUTS");
    expect(c).toMatchObject({ overdue: true, outstanding: ["ATTENDANCE", "OVERTIME"] });
    // a cut-off still well ahead is not chased yet; one within the lead time is
    expect(planReminders(facts({}, [m("inputCutoff", "Inputs", 5), m("draftDue", "Draft", 8)])).some((x) => x.kind === "CLIENT_INPUTS")).toBe(false);
    expect(planReminders(facts({}, [m("inputCutoff", "Inputs", 2), m("draftDue", "Draft", 5)])).find((x) => x.kind === "CLIENT_INPUTS")).toMatchObject({ overdue: false });
  });

  it("doesn't chase inputs that have all arrived", () => {
    const p = planReminders(facts({ outstandingInputs: [] }, [m("inputCutoff", "Inputs", -1, true), m("draftDue", "Draft", 2)]));
    expect(p.some((x) => x.kind === "CLIENT_INPUTS")).toBe(false);
  });

  it("asks for approval only once the draft exists, and only as the deadline nears or passes", () => {
    const base = [m("inputCutoff", "Inputs", -5, true), m("payDate", "Pay", 6)];
    const early = planReminders(facts({}, [...base, m("draftDue", "Draft", -1, true), m("approvalDue", "Approval", 1)]));
    expect(early.find((x) => x.kind === "CLIENT_APPROVAL")).toMatchObject({ overdue: false });
    expect(planReminders(facts({}, [...base, m("draftDue", "Draft", -1, false), m("approvalDue", "Approval", 1)])).some((x) => x.kind === "CLIENT_APPROVAL")).toBe(false); // no draft yet
    expect(planReminders(facts({}, [...base, m("draftDue", "Draft", -4, true), m("approvalDue", "Approval", -1)])).find((x) => x.kind === "CLIENT_APPROVAL")).toMatchObject({ overdue: true });
    expect(planReminders(facts({}, [...base, m("draftDue", "Draft", -4, true), m("approvalDue", "Approval", 6)])).some((x) => x.kind === "CLIENT_APPROVAL")).toBe(false); // plenty of time
  });

  it("gives the team one digest of what is overdue or due soon, and none when nothing is", () => {
    const d = planReminders(facts()).find((x) => x.kind === "TEAM_DIGEST");
    expect(d && d.kind === "TEAM_DIGEST" && d.rows.map((r) => r.label)).toEqual(["Inputs due from the client", "Draft payroll due"]); // approval is 4 days off
    expect(planReminders(facts({ outstandingInputs: [] }, [m("inputCutoff", "I", 10), m("draftDue", "D", 12)])).length).toBe(0);
    expect(planReminders(facts({ outstandingInputs: [] }, [m("inputCutoff", "I", -9, true), m("draftDue", "D", -6, true), m("approvalDue", "A", -4, true), m("payDate", "P", -1, true), m("remittanceDue", "R", 5, true)])).length).toBe(0);
  });
});

describe("the emails", () => {
  it("name the client, the month, the deadline and exactly what is owed", () => {
    const f = facts();
    const inputs = planReminders(f).find((x) => x.kind === "CLIENT_INPUTS");
    if (inputs?.kind !== "CLIENT_INPUTS") throw new Error("expected an inputs reminder");
    const mail = renderClientInputs(f, inputs, TODAY, "Mrs Bello");
    expect(mail.subject).toBe("Payroll inputs for October 2026 are overdue");
    expect(mail.text).toMatch(/Dear Mrs Bello,/);
    expect(mail.text).toMatch(/1 day\(s\) ago, on 2026-10-20/);
    expect(mail.text).toMatch(/Attendance \/ work register/);
    expect(mail.text).toMatch(/Overtime/);
    expect(mail.text).toMatch(/ThreeRoots Payroll Services/);
    expect(renderClientInputs(f, { ...inputs, overdue: false, due: TODAY }, TODAY).subject).toMatch(/are due today/);
    expect(renderClientInputs(f, inputs, TODAY).text).toMatch(/^Hello,/);
  });

  it("escape anything that could be taken for markup", () => {
    const f = facts({ clientName: "A <b>&</b> Co" });
    const mail = renderClientApproval(f, { kind: "CLIENT_APPROVAL", due: TODAY, overdue: false }, TODAY, 'Bad "name"');
    expect(mail.html).not.toContain("<b>&</b>");
    expect(mail.html).toContain("A &lt;b&gt;&amp;&lt;/b&gt; Co");
    expect(mail.html).toContain("Bad &quot;name&quot;");
    expect(mail.subject).toBe("Payroll for October 2026 is waiting for your approval");
  });

  it("tell the team how late or how soon each deadline is, with a link to the month", () => {
    const f = facts();
    const digest = planReminders(f).find((x) => x.kind === "TEAM_DIGEST");
    if (digest?.kind !== "TEAM_DIGEST") throw new Error("expected a digest");
    const mail = renderTeamDigest(f, digest, "https://app.example/", "per1");
    expect(mail.subject).toBe("Acme Ltd October 2026: 1 overdue, 1 due soon");
    expect(mail.text).toMatch(/Inputs due from the client: 1 day\(s\) late \(2026-10-20\)/);
    expect(mail.text).toMatch(/Draft payroll due: in 2 day\(s\)/);
    expect(mail.text).toMatch(/Inputs still expected: Attendance/);
    expect(mail.text).toContain("https://app.example/payroll/calendar/per1");
  });
});
