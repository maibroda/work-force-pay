import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A browser ("use client") component must not reach, through any chain of imports, a file that needs Node: the production build (npm run build) cannot bundle those for the browser
 * and fails with "Reading from node:crypto is not handled". Tests, lint and the type check cannot see this, which is how it once reached main. This test follows every import of
 * every client component and fails, naming the chain, if it reaches a Node-only import.
 */
const SRC = join(process.cwd(), "src");
const NODE_ONLY = /from\s+["'](?:node:[a-z/_]+|crypto|fs|path|child_process|os|net|tls|server-only)["']/;

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

const resolve = (spec: string): string | null => {
  if (!spec.startsWith("@/")) return null; // a package, not our own file
  const base = join(SRC, spec.slice(2));
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* try the next */
    }
  }
  return null;
};

/** The files a file imports for real (a type-only import is erased and costs nothing in the browser). */
const importsOf = (file: string): string[] => {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)) if (!m[1]) out.push(m[2]);
  for (const m of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  return out.map(resolve).filter((x): x is string => !!x);
};

function chainToNode(start: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    const here = [...chain, file.replace(SRC, "src").split("\\").join("/")];
    if (/^s*["']use server["']/.test(text)) return null; // a server action: the build swaps it for a stub, so what it imports never reaches the browser
    if (NODE_ONLY.test(text)) return here;
    for (const next of importsOf(file)) {
      if (/\/server\//.test(next.split("\\").join("/"))) return [...here, next.replace(SRC, "src").split("\\").join("/")]; // a client file must never import a server module at all
      const hit = walk(next, here);
      if (hit) return hit;
    }
    return null;
  };
  return walk(start, []);
}

describe("browser components", () => {
  it("never reach a Node-only import or a server module, however indirectly", () => {
    const client = files(SRC).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    expect(client.length).toBeGreaterThan(20); // the scan is really looking at the components
    const bad = client.map((f) => ({ f, chain: chainToNode(f) })).filter((x) => x.chain).map((x) => x.chain!.join("  ->  "));
    expect(bad).toEqual([]);
  });
});
