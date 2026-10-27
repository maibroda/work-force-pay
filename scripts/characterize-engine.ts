/**
 * Writes tests/characterization/engine-before.json: what the payroll engine produces today on the synthetic scenarios in
 * tests/characterization/scenarios.ts. Run it ONCE, on the code you want to remember, before rebuilding the arithmetic:
 *
 *   npx tsx scripts/characterize-engine.ts
 *
 * Do not re-run it to make a failing test pass; a difference is meant to be seen, explained and listed in engine-deviations.json.
 */
import fs from "node:fs";
import path from "node:path";
import { runAll } from "../tests/characterization/scenarios";

const result = runAll();
const file = path.resolve(__dirname, "../tests/characterization/engine-before.json");
fs.writeFileSync(file, `${Object.entries(result).map(([id, r], i, all) => `${i === 0 ? "{" : ""}${JSON.stringify(id)}:${JSON.stringify(r)}${i === all.length - 1 ? "}" : ","}`).join("\n")}\n`);
const figures = Object.values(result).reduce((a, r) => a + Object.keys(r).length, 0);
console.log(`Wrote ${path.relative(process.cwd(), file)}: ${Object.keys(result).length} scenarios, ${figures} figures.`);
