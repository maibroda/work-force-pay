/**
 * A small sliding-window rate limiter kept in the memory of one server process. It slows down a person or program that hammers a public address (the unsubscribe
 * link), downloads data again and again (CSV and data-request exports), or sends email in bulk. It is NOT a shared limit: with several servers each keeps its own count,
 * so the real ceiling is the limit times the number of servers; put a limit at the proxy as well when the app is hosted. A call that is refused is not counted, so waiting
 * the stated time is always enough. The number of keys is bounded, so it cannot be used to fill memory.
 */
export interface LimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface Limiter {
  /** Mutable so a test can lower it. */
  limit: number;
  readonly windowMs: number;
  check(key: string, now?: number): LimitResult;
  size(): number;
  reset(): void;
}

export function createLimiter(o: { limit: number; windowMs: number; maxKeys?: number }): Limiter {
  const maxKeys = o.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  /** Forgets keys with nothing inside the window (at most once a second, so a busy server does not scan the map on every call). */
  const sweep = (now: number) => {
    if (now - lastSweep < Math.min(o.windowMs, 1_000) && hits.size <= maxKeys) return;
    lastSweep = now;
    for (const [k, v] of hits) if (!v.length || v[v.length - 1] <= now - o.windowMs) hits.delete(k);
    // still too many distinct keys: drop the ones that have been quiet longest
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
  };

  const limiter: Limiter = {
    limit: o.limit,
    windowMs: o.windowMs,
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - o.windowMs);
      if (recent.length >= limiter.limit) {
        hits.set(key, recent);
        return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + o.windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.delete(key); // re-inserted last, so the oldest-quiet key is first in line to be dropped
      hits.set(key, recent);
      sweep(now);
      return { ok: true, remaining: limiter.limit - recent.length, retryAfterSeconds: 0 };
    },
    size: () => hits.size,
    reset: () => hits.clear(),
  };
  return limiter;
}

/**
 * The address a request came from, as the first hop of x-forwarded-for (or x-real-ip). It can only be trusted when the app sits behind a proxy that sets it; anything that is
 * not a plain address is "unknown", so a hostile header cannot be used to make up keys.
 */
export function clientIp(h: Headers): string {
  const raw = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(raw) ? raw : "unknown";
}

/** The public unsubscribe address: 30 a minute from one address. */
export const unsubscribeLimiter = createLimiter({ limit: 30, windowMs: 60_000 });
/** A person downloading data (CSV exports, reports, data-request files): 10 in five minutes. */
export const exportLimiter = createLimiter({ limit: 10, windowMs: 5 * 60_000 });
/** A person sending email to contacts from the sales module: 60 an hour. */
export const emailSendLimiter = createLimiter({ limit: 60, windowMs: 60 * 60_000 });
