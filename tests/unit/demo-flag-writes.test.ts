import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The demo flag (Organization.isDemo, approved by the founder on 2026-11-19) is set ONLY by the seed (prisma/seed.ts), never by a screen, an action or a service. This reads the source and fails if
// anything under src/ writes it, or if a file the founder has not seen starts to mention it. A file that only READS the flag is listed here on purpose.

const ROOT = path.resolve(__dirname, "../..");
const READERS = new Set(["src/server/services/demo-guard.ts", "src/app/(app)/layout.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("who may touch the demo flag", () => {
  const files = walk(path.join(ROOT, "src")).map((f) => ({ rel: path.relative(ROOT, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") }));
  const mentions = files.filter((f) => f.text.includes("isDemo"));

  it("only the files listed here mention it, and the list is short", () => {
    expect(mentions.map((f) => f.rel).sort()).toEqual([...READERS].sort());
  });

  it("nothing under src writes it (no create or update puts isDemo in its data)", () => {
    const writes = mentions.filter((f) => /data\s*:\s*\{[^{}]*\bisDemo\b/s.test(f.text) || /\bisDemo\s*:\s*(true|false)\s*,?\s*\}\s*\)\s*;?\s*$/m.test(f.text.replace(/where\s*:\s*\{[^{}]*\}/gs, "")));
    expect(writes.map((f) => f.rel)).toEqual([]);
  });

  it("the seed is where it is set", () => {
    const seed = fs.readFileSync(path.join(ROOT, "prisma/seed.ts"), "utf8");
    expect(seed).toMatch(/updateMany\(\{ data: \{ isDemo: true \} \}\)/);
  });
});
