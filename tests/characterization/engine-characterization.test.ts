import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAll, SCENARIO_COUNT } from "./scenarios";

/**
 * The payroll engine against what it produced BEFORE the arithmetic was rebuilt (docs/plans/exact-money.md).
 *
 * `engine-before.json` was written by scripts/characterize-engine.ts from the old code on synthetic scenarios. It records what the engine did, not that
 * it was right. Every figure must still be equal, EXCEPT those listed in `engine-deviations.json`: each entry is a figure that changed on purpose, with the
 * old value, the new value and the working that shows the new one is the exact half-up answer. A deviation that no longer applies is an error, so the list
 * cannot go stale; a figure that changes and is NOT on the list fails the test.
 */
const dir = __dirname;
const before: Record<string, Record<string, number>> = JSON.parse(fs.readFileSync(path.join(dir, "engine-before.json"), "utf8"));
const deviationsFile = path.join(dir, "engine-deviations.json");
const deviations: Record<string, { old: number; new: number; why: string }> = fs.existsSync(deviationsFile)
  ? JSON.parse(fs.readFileSync(deviationsFile, "utf8"))
  : {};

describe("payroll engine characterization", () => {
  const now = runAll();

  it("covers every scenario that was recorded, with the same figures present", () => {
    expect(Object.keys(now)).toEqual(Object.keys(before));
    expect(Object.keys(before)).toHaveLength(SCENARIO_COUNT);
    for (const id of Object.keys(before)) expect(Object.keys(now[id]).sort(), id).toEqual(Object.keys(before[id]).sort());
  });

  it("changes no figure except those listed, with their working, in engine-deviations.json", () => {
    const unexplained: string[] = [];
    for (const [id, figures] of Object.entries(before))
      for (const [name, old] of Object.entries(figures)) {
        const got = now[id][name];
        const listed = deviations[`${id}|${name}`];
        const expected = listed ? listed.new : old;
        if (got !== expected) unexplained.push(`${id} ${name}: was ${old}, now ${got}${listed ? ` (list says ${listed.new})` : ""}`);
      }
    expect(unexplained.slice(0, 20), `${unexplained.length} unexplained differences`).toEqual([]);
  });

  it("keeps the deviations list honest: every entry matches the recorded old value, differs from it, and still applies", () => {
    const bad: string[] = [];
    for (const [key, dev] of Object.entries(deviations)) {
      const [id, name] = key.split("|");
      if (before[id]?.[name] !== dev.old) bad.push(`${key}: old value in the list is not the recorded one`);
      if (dev.old === dev.new) bad.push(`${key}: lists no change`);
      if (now[id]?.[name] !== dev.new) bad.push(`${key}: no longer applies (now ${now[id]?.[name]})`);
      if (!dev.why || dev.why.length < 20) bad.push(`${key}: no working given`);
    }
    expect(bad).toEqual([]);
  });
});
