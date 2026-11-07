import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  backTarget,
  EMPLOYEE_STATIC_SEGMENTS,
  isDirectoryUrl,
  markRestore,
  onNavigate,
  profileIdFromPath,
  rememberScroll,
  safeInternal,
  takeRestore,
  type NavState,
} from "@/lib/profile-nav";

// The back arrow on an employee profile (the founder's request of 2026-11-07): it returns to where the person came from, with the directory's
// search, filters, page and scroll position, and falls back to the directory.

describe("which addresses are an employee's profile", () => {
  it("is /employees/<id>, with or without a tab or other query", () => {
    expect(profileIdFromPath("/employees/abc123")).toBe("abc123");
    expect(profileIdFromPath("/employees/abc123?tab=documents")).toBe("abc123");
    expect(profileIdFromPath("/employees/abc123/")).toBe("abc123");
  });
  it("is not the directory, the other pages inside Employees, or anything else", () => {
    for (const p of ["/employees", "/employees?q=ada", "/employees/new", "/employees/import", "/employees/org-chart", "/employees/pay-rates", "/hr/exits/abc", "/", "/employees/abc/def"]) expect(profileIdFromPath(p), p).toBeNull();
  });
  it("knows every other page inside Employees: the list cannot drift from the folders", () => {
    const dir = path.join(__dirname, "../../src/app/(app)/employees");
    const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "[id]").map((d) => d.name).sort();
    expect([...EMPLOYEE_STATIC_SEGMENTS].sort()).toEqual(folders);
  });
});

describe("only an address inside the app can be a place to go back to", () => {
  it("accepts a path with a query and refuses anything that could leave the site", () => {
    expect(safeInternal("/employees?q=ada&page=2")).toBe("/employees?q=ada&page=2");
    for (const bad of ["//evil.example", "https://evil.example/x", "javascript:alert(1)", "evil", "", undefined, null, 5]) expect(safeInternal(bad as never), String(bad)).toBeNull();
  });
});

const go = (state: NavState, ...steps: Array<[string | null, string]>) => steps.reduce((s, [from, to]) => onNavigate(s, from, to), state);

describe("the way back", () => {
  it("from the directory with a search and a page: the same search and page", () => {
    const s = go({}, [null, "/employees?q=ada&category=guard&page=3"], ["/employees?q=ada&category=guard&page=3", "/employees/e1"]);
    expect(backTarget(s, "e1")).toBe("/employees?q=ada&category=guard&page=3");
  });
  it("stays the same while the person moves between the profile's tabs", () => {
    const s = go({}, ["/employees?page=2", "/employees/e1"], ["/employees/e1", "/employees/e1?tab=documents"], ["/employees/e1?tab=documents", "/employees/e1?tab=pay"]);
    expect(backTarget(s, "e1")).toBe("/employees?page=2");
  });
  it("from another supported entry point: back to that place", () => {
    const s = go({}, ["/hr/exits/x9", "/employees/e1"], ["/employees/e1", "/employees/e1?tab=lifecycle"]);
    expect(backTarget(s, "e1")).toBe("/hr/exits/x9");
  });
  it("after a refresh or a bookmark (nothing remembered for this profile): the last directory, else the directory", () => {
    expect(backTarget({}, "e1")).toBe("/employees");
    expect(backTarget({ dir: "/employees?q=ada" }, "e1")).toBe("/employees?q=ada");
  });
  it("never uses another employee's origin: it falls back to the last directory instead", () => {
    const s = go({}, ["/hr/exits/x9", "/employees/e1"]);
    expect(backTarget(s, "e2")).toBe("/employees"); // nothing remembered of the directory yet
    const t = go({}, ["/employees?page=2", "/employees/e1"]);
    expect(backTarget(t, "e2")).toBe("/employees?page=2");
  });
  it("from one profile to another (the org chart, say): back to the first, and the directory is still remembered", () => {
    const s = go({}, ["/employees?page=2", "/employees/e1"], ["/employees/e1", "/employees/e2"]);
    expect(backTarget(s, "e2")).toBe("/employees/e1");
    expect(s.dir).toBe("/employees?page=2");
  });
  it("remembers the newest directory address when the filters change between two directory pages", () => {
    const s = go({}, ["/employees?page=1", "/employees?page=2"], ["/employees?page=2", "/employees?q=ada"]);
    expect(s.dir).toBe("/employees?q=ada");
  });
  it("ignores a stored address that is not inside the app", () => {
    expect(backTarget({ origin: { id: "e1", url: "//evil.example" }, dir: "https://evil.example" }, "e1")).toBe("/employees");
  });
});

describe("the scroll position", () => {
  it("is remembered per address, a few at a time", () => {
    let s: NavState = {};
    for (let i = 0; i < 30; i++) s = rememberScroll(s, `/employees?page=${i}`, i * 10);
    expect(Object.keys(s.scroll ?? {}).length).toBeLessThanOrEqual(20);
    expect(s.scroll?.["/employees?page=29"]).toBe(290);
    expect(s.scroll?.["/employees?page=0"]).toBeUndefined();
  });
  it("is restored once, only on the address the arrow sent the person to", () => {
    let s = rememberScroll({}, "/employees?page=2", 640);
    s = markRestore(s, "/employees?page=2");
    expect(takeRestore(s, "/employees?page=9").y).toBeNull();
    const t = takeRestore(s, "/employees?page=2");
    expect(t.y).toBe(640);
    expect(takeRestore(t.state, "/employees?page=2").y).toBeNull();
  });
  it("does nothing for an address with no remembered position", () => {
    const s = markRestore({}, "/employees");
    expect(takeRestore(s, "/employees").y).toBeNull();
  });
});

describe("what the arrow says", () => {
  it("is about the directory only when it goes to the directory", () => {
    expect(isDirectoryUrl("/employees")).toBe(true);
    expect(isDirectoryUrl("/employees?q=ada&page=2")).toBe(true);
    for (const u of ["/hr/discipline/abc", "/employees/abc", "/employees/org-chart", "/"]) expect(isDirectoryUrl(u), u).toBe(false);
  });
});
