import { describe, expect, it } from "vitest";
import { AREAS, NAV, SELF_NAV } from "@/lib/nav";
import { advanceTrail, afterBack, backDestination, fallbackFor, homeFor, MAX_TRAIL, SECTION_HOMES, type Trail } from "@/lib/global-back";

// The global Back button (the founder's brief of 2026-11-13): it returns to the page the person was just on, inside the app; when there is none (a direct address, a bookmark, a new
// tab) it goes to the parent module or the person's home page, never outside the app, and never in a loop. Pure rules: the state lives in sessionStorage (src/lib/nav-storage.ts)
// and the tracker (src/components/nav-tracker.tsx) keeps it up to date.

const visit = (urls: string[], start: Trail = {}): Trail => {
  let s = start;
  let from: string | null = null;
  for (const u of urls) {
    s = advanceTrail(s, from, u);
    from = u;
  }
  return s;
};

describe("scenario A: a module, then a record", () => {
  it("Back from an employee-style record returns to the list it was opened from", () => {
    const s = visit(["/hr/contracts", "/hr/contracts/cmabc123def456ghi789jkl0"]);
    expect(backDestination(s, "/hr/contracts/cmabc123def456ghi789jkl0", "/")).toEqual({ href: "/hr/contracts", kind: "previous" });
  });
});

describe("scenario B and C: several levels", () => {
  const A = "/payroll/runs";
  const B = "/payroll/runs/cmrun123def456ghi789jkl00";
  const C = "/payroll/runs/cmrun123def456ghi789jkl00/records";
  it("each Back click returns to the immediately preceding page", () => {
    let s = visit([A, B, C]);
    expect(backDestination(s, C, "/")!.href).toBe(B);
    // the person uses Back: the destination is reached, the trail drops the page they left
    s = advanceTrail(afterBack(s, B, "previous"), C, B);
    expect(backDestination(s, B, "/")!.href).toBe(A);
    s = advanceTrail(afterBack(s, A, "previous"), B, A);
    expect(s.trail).toEqual([A]);
  });
  it("browser back and a link to the previous page count the same way: the trail drops the page that was left", () => {
    const s = visit(["/a", "/a/b", "/a/b/c", "/a/b"]);
    expect(s.trail).toEqual(["/a", "/a/b"]);
  });
  it("a new page is pushed once, the same address twice is not, and a changed search is a new page", () => {
    expect(visit(["/hr/contracts", "/hr/contracts"]).trail).toEqual(["/hr/contracts"]);
    expect(visit(["/hr/contracts?page=1", "/hr/contracts?page=2"]).trail).toEqual(["/hr/contracts?page=1", "/hr/contracts?page=2"]);
  });
  it("keeps only the most recent pages", () => {
    const urls = Array.from({ length: MAX_TRAIL + 10 }, (_, i) => `/page/${i}`);
    const s = visit(urls);
    expect(s.trail).toHaveLength(MAX_TRAIL);
    expect(s.trail![s.trail!.length - 1]).toBe(urls[urls.length - 1]);
  });
});

describe("scenario D: direct access, a refresh, a new tab", () => {
  it("with no earlier page in the app, Back goes to the parent module, never outside the app", () => {
    const s = visit(["/hr/contracts/cmabc123def456ghi789jkl0"]);
    expect(backDestination(s, "/hr/contracts/cmabc123def456ghi789jkl0", "/")).toEqual({ href: "/hr/contracts", kind: "parent" });
    expect(backDestination({}, "/settings/hr-officers", "/")).toEqual({ href: "/settings/organization", kind: "parent" });
  });
  it("a refresh keeps the trail: the same address arriving again changes nothing", () => {
    const s = visit(["/hr", "/hr/contracts"]);
    expect(advanceTrail(s, null, "/hr/contracts")).toEqual(s);
    expect(backDestination(advanceTrail(s, null, "/hr/contracts"), "/hr/contracts", "/")!.href).toBe("/hr");
  });
  it("never offers an address outside the app", () => {
    const s: Trail = { trail: ["https://evil.example/x", "//evil.example", "/ok", "/ok/next"] };
    expect(backDestination(s, "/ok/next", "/")!.href).toBe("/ok");
    const bad: Trail = { trail: ["//evil.example", "/ok/next"] };
    expect(backDestination(bad, "/ok/next", "/")).toEqual({ href: "/", kind: "parent" }); // an unknown module: the person's home
  });
});

describe("no loops", () => {
  it("the fallback always moves up and ends at the person's home, where there is nothing to go back to", () => {
    let url = "/payroll/runs/cmrun123def456ghi789jkl00/records";
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      expect(seen.has(url), url).toBe(false);
      seen.add(url);
      const next = fallbackFor(url, "/");
      if (next === "/") break;
      url = next;
    }
    expect(fallbackFor("/payroll/runs", "/")).toBe("/");
    expect(fallbackFor("/", "/")).toBe("/");
  });
  it("using the fallback starts a fresh trail at the parent, so Back from there goes further up and never back down", () => {
    let s = visit(["/hr/contracts/cmabc123def456ghi789jkl0"]);
    const first = backDestination(s, "/hr/contracts/cmabc123def456ghi789jkl0", "/")!;
    s = advanceTrail(afterBack(s, first.href, first.kind), "/hr/contracts/cmabc123def456ghi789jkl0", first.href);
    expect(s.trail).toEqual(["/hr/contracts"]);
    expect(backDestination(s, "/hr/contracts", "/")).toEqual({ href: "/hr", kind: "parent" });
  });
  it("hides the button on a person's landing page when there is nowhere to go back to", () => {
    expect(backDestination({}, "/", "/")).toBeNull();
    expect(backDestination({}, "/me", "/me")).toBeNull();
    expect(backDestination({}, "/portal", "/")).toBeNull();
    expect(backDestination(visit(["/hr", "/me"]), "/me", "/me")).toEqual({ href: "/hr", kind: "previous" }); // but shows it when there is a previous page
  });
});

describe("the person's home", () => {
  it("is the dashboard for anyone who can open it, otherwise My Workspace (an employee would be refused the dashboard)", () => {
    expect(homeFor(true)).toBe("/");
    expect(homeFor(false)).toBe("/me");
  });
  it("is the fallback at the top of every module: an employee on a My Workspace page goes to /me, not to a page they cannot open", () => {
    expect(fallbackFor("/me/leave", "/me")).toBe("/me");
    expect(fallbackFor("/me", "/me")).toBe("/me");
    expect(backDestination({}, "/me", "/me")).toBeNull();
  });
});

describe("the module homes", () => {
  it("every module home is a real page the sidebar or a tab row links to, so the table cannot drift from the app", () => {
    const hrefs = new Set<string>([
      ...NAV.flatMap((g) => g.items.map((i) => i.href)),
      ...SELF_NAV.flatMap((g) => g.items.map((i) => i.href)),
      ...AREAS.flatMap((a) => a.sections.map((s) => s.href)),
    ]);
    for (const [module, home] of Object.entries(SECTION_HOMES)) expect(hrefs.has(home), `${module} -> ${home}`).toBe(true);
  });
  it("covers the modules in the sidebar", () => {
    for (const first of ["hr", "payroll", "settings", "employees", "analytics", "finance", "operations", "me"]) expect(SECTION_HOMES[first], first).toBeTruthy();
  });
});

describe("a record's list", () => {
  it("drops a trailing record id (cuid, uuid or number) and nothing else", () => {
    expect(fallbackFor("/hr/contracts/cmabc123def456ghi789jkl0", "/")).toBe("/hr/contracts");
    expect(fallbackFor("/hr/contracts/123e4567-e89b-12d3-a456-426614174000", "/")).toBe("/hr/contracts");
    expect(fallbackFor("/hr/contracts", "/")).toBe("/hr");
    expect(fallbackFor("/hr/welfare-cases", "/")).toBe("/hr");
    expect(fallbackFor("/unknown-module/page", "/")).toBe("/");
  });
});
