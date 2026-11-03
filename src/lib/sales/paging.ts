/**
 * Paging for the sales lists. A list asked for a page returns that page only (at most MAX_PAGE_SIZE rows, whatever the caller asks); a list not asked for one keeps its old
 * behaviour, the first LEGACY_CAP rows, which the pickers that need "everything I can see" still use. Anything that is not a whole number of at least 1 is taken as the first page.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const LEGACY_CAP = 500;

export interface PagingInput {
  page?: unknown;
  pageSize?: unknown;
}
export interface Paging {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

const whole = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : null;
};

export function pagingOf(f?: PagingInput): Paging {
  if (!f || (f.page === undefined && f.pageSize === undefined)) return { page: 1, pageSize: LEGACY_CAP, skip: 0, take: LEGACY_CAP };
  const page = whole(f.page) ?? 1;
  const pageSize = Math.min(whole(f.pageSize) ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

/** What a pager shows: the page (brought back to the last one if it is past the end), how many pages, and which rows are on it. */
export function windowOf(total: number, p: { page: number; pageSize: number }) {
  const pages = pageCount(total, p.pageSize);
  const page = Math.min(p.page, pages);
  return { page, pageSize: p.pageSize, pages, total, from: total === 0 ? 0 : (page - 1) * p.pageSize + 1, to: Math.min(total, page * p.pageSize) };
}
