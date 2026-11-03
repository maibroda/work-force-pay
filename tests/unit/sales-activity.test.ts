import { describe, expect, it } from "vitest";
import { defaultWhatsAppText, filterTimeline, groupTasks, mergeTimeline, surveySchema, telLink, waLink, watDayStart, type TimelineItem } from "@/lib/sales/activity";

const at = (s: string) => new Date(s);

describe("call and WhatsApp links", () => {
  it("builds a tel link and a wa.me link with the message encoded, from an E.164 number only", () => {
    expect(telLink("+2348031234567")).toBe("tel:+2348031234567");
    expect(waLink("+2348031234567", "Hello & welcome, Mrs Bello")).toBe("https://wa.me/2348031234567?text=Hello%20%26%20welcome%2C%20Mrs%20Bello");
    expect(waLink("+2348031234567", "")).toBe("https://wa.me/2348031234567");
    for (const bad of ["08031234567", "2348031234567", "+234 803 123 4567", "+23480", "javascript:alert(1)", null, undefined, ""]) {
      expect(telLink(bad as never)).toBeNull();
      expect(waLink(bad as never, "x")).toBeNull();
    }
  });

  it("starts a WhatsApp message from the person's first name and the company, for the user to edit", () => {
    expect(defaultWhatsAppText({ firstName: "Funmi", company: "Lekki Gardens Estate", sender: "Adaeze" })).toBe("Hello Funmi, this is Adaeze, about security services for Lekki Gardens Estate.");
    expect(defaultWhatsAppText({ firstName: null, company: null, sender: "Adaeze" })).toBe("Hello, this is Adaeze.");
  });
});

describe("site survey checklist", () => {
  it("takes the site type, entry points, existing guards, risk notes and up to ten photo links", () => {
    const ok = surveySchema.parse({ siteType: "Residential estate", entryPoints: 3, existingGuards: 0, riskNotes: "Perimeter fence is broken on the north side", photoLinks: ["https://example.test/a.jpg"] });
    expect(ok.entryPoints).toBe(3);
    expect(() => surveySchema.parse({ siteType: "Estate", entryPoints: -1 })).toThrow(/entry points/i);
    expect(() => surveySchema.parse({ siteType: "Estate", entryPoints: 1.5 })).toThrow(/whole number/i);
    expect(() => surveySchema.parse({ siteType: "Estate", photoLinks: ["javascript:alert(1)"] })).toThrow(/link/i);
    expect(() => surveySchema.parse({ siteType: "Estate", photoLinks: Array.from({ length: 11 }, (_, i) => `https://example.test/${i}.jpg`) })).toThrow(/at most 10/i);
    expect(() => surveySchema.parse({ siteType: "" })).toThrow(/site type/i);
  });
});

describe("the timeline", () => {
  const item = (id: string, type: TimelineItem["type"], when: string): TimelineItem => ({ id, type, at: at(when), title: id });

  it("is newest first, with the same moment ordered the same way every time, and can be filtered by type", () => {
    const items = [item("a", "NOTE", "2026-10-01T10:00:00Z"), item("c", "CALL", "2026-10-03T10:00:00Z"), item("b", "STAGE", "2026-10-03T10:00:00Z"), item("d", "CONSENT", "2026-09-30T10:00:00Z")];
    expect(mergeTimeline(items).map((x) => x.id)).toEqual(["c", "b", "a", "d"]);
    expect(mergeTimeline([...items].reverse()).map((x) => x.id)).toEqual(["c", "b", "a", "d"]);
    expect(filterTimeline(mergeTimeline(items), ["CALL", "NOTE"]).map((x) => x.id)).toEqual(["c", "a"]);
    expect(filterTimeline(mergeTimeline(items), []).length).toBe(4);
  });
});

describe("tasks by the Lagos day", () => {
  it("finds the start of the Lagos day (UTC+1) for any moment", () => {
    expect(watDayStart(at("2026-10-29T23:30:00Z")).toISOString()).toBe("2026-10-29T23:00:00.000Z"); // 00:30 on 30 October in Lagos
    expect(watDayStart(at("2026-10-29T10:00:00Z")).toISOString()).toBe("2026-10-28T23:00:00.000Z");
  });

  it("groups open tasks as overdue, today, this week and later, and leaves out finished ones", () => {
    const now = at("2026-10-29T10:00:00Z"); // 11:00 on Thursday 29 October in Lagos
    const t = (id: string, due: string, status = "OPEN") => ({ id, dueAt: at(due), status });
    const g = groupTasks(
      [
        t("yesterday", "2026-10-28T14:00:00Z"),
        t("earlier-today", "2026-10-29T08:00:00Z"), // 09:00 Lagos: its time has passed
        t("later-today", "2026-10-29T15:00:00Z"), // 16:00 Lagos
        t("end-of-today", "2026-10-29T22:59:00Z"), // 23:59 Lagos, still today
        t("midnight", "2026-10-29T23:00:00Z"), // 00:00 Friday Lagos
        t("sunday", "2026-11-01T20:00:00Z"), // 21:00 Sunday Lagos, still this week
        t("monday", "2026-11-01T23:00:00Z"), // 00:00 Monday Lagos: next week
        t("done", "2026-10-28T14:00:00Z", "DONE"),
        t("cancelled", "2026-10-30T14:00:00Z", "CANCELLED"),
      ],
      now,
    );
    expect(g.overdue.map((x) => x.id)).toEqual(["yesterday", "earlier-today"]);
    expect(g.today.map((x) => x.id)).toEqual(["later-today", "end-of-today"]);
    expect(g.thisWeek.map((x) => x.id)).toEqual(["midnight", "sunday"]);
    expect(g.later.map((x) => x.id)).toEqual(["monday"]);
  });
});
