import { describe, expect, it } from "vitest";
import { eraseFrom, erasureBlockers, type ErasureFacts } from "@/lib/employee-retention";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const facts = (over: Partial<ErasureFacts> = {}): ErasureFacts => ({
  years: 6,
  status: "RESIGNED",
  exitDate: day("2019-03-31"),
  anonymizedAt: null,
  today: day("2026-10-06"),
  loanOwed: 0,
  settlementsOpen: 0,
  casesOpen: 0,
  dataRequestsOpen: 0,
  alreadyPending: false,
  ...over,
});

describe("eraseFrom", () => {
  it("adds whole years to the exit date, clamping the end of February", () => {
    expect(eraseFrom(day("2019-03-31"), 6).toISOString().slice(0, 10)).toBe("2025-03-31");
    expect(eraseFrom(day("2020-02-29"), 1).toISOString().slice(0, 10)).toBe("2021-02-28");
  });
});

describe("erasureBlockers", () => {
  it("lets a leaver past the period with nothing outstanding go ahead", () => {
    expect(erasureBlockers(facts())).toEqual([]);
  });

  it("is off, with the reason given, when no retention period is set", () => {
    const b = erasureBlockers(facts({ years: 0 }));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/Set how long records are kept/);
  });

  it("keeps records until the period has run out, and says the date; the day itself is allowed", () => {
    const early = erasureBlockers(facts({ exitDate: day("2021-01-15") }));
    expect(early).toEqual(["Records must be kept until 2027-01-15 (6 years after they left)."]);
    expect(erasureBlockers(facts({ exitDate: day("2020-10-06") }))).toEqual([]);
    expect(erasureBlockers(facts({ exitDate: day("2020-10-07") }))).toHaveLength(1);
  });

  it("never touches someone who hasn't left, or has no exit date", () => {
    expect(erasureBlockers(facts({ status: "ACTIVE" }))[0]).toMatch(/haven't left/);
    expect(erasureBlockers(facts({ status: "ON_LEAVE" }))[0]).toMatch(/haven't left/);
    expect(erasureBlockers(facts({ exitDate: null }))[0]).toMatch(/no exit date/);
  });

  it("is blocked by anything still owed, open, or already waiting — and lists every reason", () => {
    const b = erasureBlockers(facts({ loanOwed: 5000, settlementsOpen: 1, casesOpen: 2, dataRequestsOpen: 1, alreadyPending: true }));
    expect(b).toHaveLength(5);
    expect(b.join(" ")).toMatch(/loan.*settlement.*case.*data access request.*already waiting/s);
  });

  it("says only that it is done once the details are already gone", () => {
    expect(erasureBlockers(facts({ anonymizedAt: day("2026-01-01"), loanOwed: 100 }))).toEqual(["Their personal details have already been removed."]);
  });
});
