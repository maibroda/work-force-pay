import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");
const read = (p: string) => fs.readFileSync(p, "utf8");

/**
 * The two-factor requirement is enforced by requirePage / requireAction. These checks catch the two ways it can
 * silently stop working: a route that reads the session itself (and so skips the check), and the app layout
 * enforcing it on the very page where someone turns two-factor on (a redirect loop that locks them out).
 */
describe("two-factor enforcement coverage", () => {
  it("every API route that reads the session also applies the two-factor gate", () => {
    const routes = walk(path.join(SRC, "app", "api")).filter((f) => /route\.ts$/.test(f) && read(f).includes("getSession("));
    expect(routes.length).toBeGreaterThan(0);
    const missing = routes.filter((f) => !read(f).includes("twoFactorStateFor")).map(rel);
    expect(missing).toEqual([]);
  });

  it("only the My security page and the app layout opt out of the gate, and the layout does", () => {
    const optOut = walk(path.join(SRC, "app")).filter((f) => /\.tsx?$/.test(f) && read(f).includes("allowUnenrolled")).map(rel);
    expect(optOut.sort()).toEqual(["app/(app)/layout.tsx", "app/(app)/settings/security/page.tsx", "app/actions/auth.ts"].sort());
  });

  it("pages other than My security never opt out", () => {
    const pages = walk(path.join(SRC, "app", "(app)")).filter((f) => /page\.tsx$/.test(f) && !rel(f).endsWith("settings/security/page.tsx"));
    expect(pages.filter((f) => read(f).includes("allowUnenrolled")).map(rel)).toEqual([]);
  });
});
