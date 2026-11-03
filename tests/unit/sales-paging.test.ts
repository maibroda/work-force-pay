import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, LEGACY_CAP, MAX_PAGE_SIZE, pageCount, pagingOf, windowOf } from "@/lib/sales/paging";

describe("paging a list", () => {
  it("starts at the first page with the default size, and asks for no more than the largest size", () => {
    expect(pagingOf({ page: 1 })).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, skip: 0, take: DEFAULT_PAGE_SIZE });
    expect(pagingOf({ page: 3, pageSize: 25 })).toEqual({ page: 3, pageSize: 25, skip: 50, take: 25 });
    expect(pagingOf({ page: 2, pageSize: 100_000 })).toMatchObject({ pageSize: MAX_PAGE_SIZE, take: MAX_PAGE_SIZE, skip: MAX_PAGE_SIZE });
  });

  it("treats nonsense as the first page and the default size, so a hostile query string cannot ask for a negative, fractional or huge window", () => {
    for (const bad of [0, -4, 1.5, NaN, Infinity, "x", null, {}, [], "9".repeat(30)]) {
      const p = pagingOf({ page: bad as never, pageSize: bad as never });
      expect(p.page, String(bad)).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(p.page)).toBe(true);
      expect(p.pageSize).toBeGreaterThanOrEqual(1);
      expect(p.pageSize).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      expect(p.skip).toBe((p.page - 1) * p.pageSize);
    }
    expect(pagingOf({ page: "2" as never })).toMatchObject({ page: 2 }); // a page number read from a web address
  });

  it("keeps the old behaviour when no page is asked for: the first LEGACY_CAP rows", () => {
    expect(pagingOf(undefined)).toEqual({ page: 1, pageSize: LEGACY_CAP, skip: 0, take: LEGACY_CAP });
    expect(pagingOf({})).toEqual({ page: 1, pageSize: LEGACY_CAP, skip: 0, take: LEGACY_CAP });
  });

  it("counts the pages, with at least one, and a page past the end is brought back to the last", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(1000, 100)).toBe(10);
    expect(windowOf(120, { page: 9, pageSize: 50 })).toEqual({ page: 3, pageSize: 50, pages: 3, total: 120, from: 101, to: 120 });
    expect(windowOf(0, { page: 1, pageSize: 50 })).toEqual({ page: 1, pageSize: 50, pages: 1, total: 0, from: 0, to: 0 });
  });
});
