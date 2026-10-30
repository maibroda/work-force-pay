import { describe, expect, it } from "vitest";
import { contractPlan, groupSites, missingForSubmit, siteKey, termEnd, type HandoverFacts } from "@/lib/sales/handover";

const post = (o: Partial<HandoverFacts["sites"][number]["posts"][number]> = {}) => ({ postLabel: "Main gate", categoryId: "cat-guard", structureId: "st-1", billPerHead: "120000.00", operativeSharePct: "70.00", businessLine: "GUARDING", requiredPersonnel: 14, headcount: 12, ...o });
const site = (o: Partial<HandoverFacts["sites"][number]> = {}): HandoverFacts["sites"][number] => ({
  id: "s1", name: "Lekki Gardens Phase 1", address: "1 Admiralty Way", state: "Lagos", lga: "Eti-Osa", contactName: "Mrs Bello", contactPhoneE164: "+2348031234567", equipment: [{ item: "Radio", quantity: 4 }], noEquipment: false,
  posts: [post()], ...o,
});
const complete = (o: Partial<HandoverFacts> = {}): HandoverFacts => ({ scope: "24/7 manned guarding", clientRequirements: "Uniformed, licensed guards", startDate: "2027-01-01", termMonths: 12, noSpecialSla: false, serviceLevels: [{ obligation: "Replace an absent guard", measure: "within 2 hours" }], sites: [site()], ...o });

describe("sites named on a quote", () => {
  it("treats the same site written differently as one site, keeping the first spelling and address", () => {
    expect(siteKey("  Lekki   Gardens PHASE 1 ")).toBe(siteKey("lekki gardens phase 1"));
    const g = groupSites([
      { siteName: "Lekki Gardens Phase 1", siteAddress: "1 Admiralty Way", id: "a" },
      { siteName: "Ikoyi Towers", siteAddress: null, id: "b" },
      { siteName: "lekki gardens  phase 1", siteAddress: "ignored", id: "c" },
    ]);
    expect(g.map((x) => [x.name, x.address, x.lines.map((l) => l.id)])).toEqual([["Lekki Gardens Phase 1", "1 Admiralty Way", ["a", "c"]], ["Ikoyi Towers", null, ["b"]]]);
  });
});

describe("the end of a contract term", () => {
  it("is the day before the term runs out", () => {
    expect(termEnd("2027-01-01", 12)).toBe("2027-12-31");
    expect(termEnd("2027-03-01", 12)).toBe("2028-02-29");
    expect(termEnd("2027-01-15", 6)).toBe("2027-07-14");
  });
});

describe("what a handover still needs before it can be sent", () => {
  it("is nothing when everything is entered", () => {
    expect(missingForSubmit(complete())).toEqual([]);
  });

  it("lists everything missing, in plain words, for an empty handover", () => {
    const m = missingForSubmit({ scope: null, clientRequirements: null, startDate: null, termMonths: null, noSpecialSla: false, serviceLevels: [], sites: [site({ address: null, state: null, lga: null, contactName: null, contactPhoneE164: null, equipment: [], posts: [post({ categoryId: null })] })] });
    expect(m).toEqual(expect.arrayContaining([
      "Scope of service", "Client requirements", "Start date", "Contract term in months", "Service-level obligations (list them, or say there are none)",
      'Site "Lekki Gardens Phase 1": address', 'Site "Lekki Gardens Phase 1": state', 'Site "Lekki Gardens Phase 1": local government',
      'Site "Lekki Gardens Phase 1": the client\'s site contact name', 'Site "Lekki Gardens Phase 1": the client\'s site contact phone',
      'Site "Lekki Gardens Phase 1": equipment (list it, or say none is needed)',
      'Post "Main gate" at "Lekki Gardens Phase 1": employee category',
    ]));
  });

  it("accepts an explicit answer of none for equipment and service levels", () => {
    expect(missingForSubmit(complete({ noSpecialSla: true, serviceLevels: [], sites: [site({ equipment: [], noEquipment: true })] }))).toEqual([]);
  });

  it("refuses to say both none and a list", () => {
    expect(missingForSubmit(complete({ noSpecialSla: true }))).toContain("Service-level obligations: you listed some and also said there are none");
    expect(missingForSubmit(complete({ sites: [site({ noEquipment: true })] }))).toContain('Site "Lekki Gardens Phase 1": equipment: you listed some and also said none is needed');
  });

  it("refuses a category that is billed at two different rates, two structures or two shares, because a contract has one rate for a category", () => {
    const rate = missingForSubmit(complete({ sites: [site({ posts: [post(), post({ postLabel: "Supervisor", billPerHead: "150000.00" })] })] }));
    expect(rate.join(" ")).toMatch(/one rate for a category/);
    const share = missingForSubmit(complete({ sites: [site({ posts: [post(), post({ operativeSharePct: "60.00" })] })] }));
    expect(share.join(" ")).toMatch(/one rate for a category/);
    const ok = missingForSubmit(complete({ sites: [site({ posts: [post(), post({ postLabel: "Side gate", requiredPersonnel: 5, headcount: 4 })] })] }));
    expect(ok).toEqual([]);
  });

  it("refuses a handover that mixes guarding and outsourcing, because a contract is one or the other", () => {
    expect(missingForSubmit(complete({ sites: [site({ posts: [post(), post({ categoryId: "cat-2", businessLine: "OUTSOURCING" })] })] })).join(" ")).toMatch(/guarding and outsourcing/);
  });
});

describe("what is made on acceptance", () => {
  it("makes one contract rate for each category, from the quote's bill rate and share", () => {
    const p = contractPlan(complete({ sites: [site({ posts: [post(), post({ postLabel: "Supervisor", categoryId: "cat-sup", structureId: "st-2", billPerHead: "150000.00", operativeSharePct: "60.00", requiredPersonnel: 2, headcount: 2 }), post({ postLabel: "Side gate", requiredPersonnel: 3, headcount: 2 })] })] }));
    expect(p.businessLine).toBe("GUARDING");
    expect(p.rates).toEqual([
      { categoryId: "cat-guard", structureId: "st-1", agreedRate: "120000.00", operativeSharePct: "70.00" },
      { categoryId: "cat-sup", structureId: "st-2", agreedRate: "150000.00", operativeSharePct: "60.00" },
    ]);
    expect(p.structureId).toBeNull(); // two structures: no single default
  });

  it("sets each site's approved strength to the people needed to cover its shifts, not the guards billed", () => {
    const p = contractPlan(complete({ sites: [site({ posts: [post(), post({ postLabel: "Supervisor", requiredPersonnel: 2, headcount: 2 })] }), site({ id: "s2", name: "Ikoyi Towers", posts: [post({ requiredPersonnel: 6, headcount: 6 })] })] }));
    expect(p.beats).toEqual([{ siteId: "s1", approvedStrength: 16 }, { siteId: "s2", approvedStrength: 6 }]);
    expect(p.structureId).toBe("st-1"); // one structure throughout: it becomes the contract's default
  });
});
