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

const PLAIN_ADDRESS = /^[0-9a-fA-F:.]{2,45}$/;
const asAddress = (raw: string | null | undefined) => {
  const v = (raw ?? "").trim();
  return PLAIN_ADDRESS.test(v) ? v : "unknown";
};

/**
 * The address a request came from. A forwarding header is only as good as the proxy that wrote it: anyone can send "x-forwarded-for: 1.2.3.4" themselves. So NO header is
 * trusted unless the company says how many proxies it sits behind, or which single header its proxy sets:
 *  - TRUSTED_IP_HEADER (for example cf-connecting-ip or x-real-ip): that header is the address, and it wins;
 *  - TRUSTED_PROXY_HOPS (a whole number from 1): the n-th address from the RIGHT of x-forwarded-for, which is the one the nearest trusted proxy saw (what a visitor typed is on
 *    the left and cannot be chosen).
 * With neither set, or with a setting that is not understood, the answer is "unknown". Anything that is not a plain address is also "unknown", so a hostile header cannot be
 * used to make up keys.
 */
export function clientIp(h: Headers, env: Record<string, string | undefined> = process.env): string {
  const single = env.TRUSTED_IP_HEADER?.trim();
  if (single) return asAddress(h.get(single));
  const hops = /^[1-9][0-9]{0,1}$/.test((env.TRUSTED_PROXY_HOPS ?? "").trim()) ? Number(env.TRUSTED_PROXY_HOPS) : 0;
  if (!hops) return "unknown";
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return chain.length >= hops ? asAddress(chain[chain.length - hops]) : "unknown";
}

/** What a visitor is counted under: their address, or, when it is not known, their own link, so one unknown visitor cannot use up the allowance of every other. */
export function limitKey(ip: string, token: string): string {
  return ip !== "unknown" ? ip : `unknown:${token.slice(0, 24)}`;
}

/** The public unsubscribe address: 30 a minute from one address. */
export const unsubscribeLimiter = createLimiter({ limit: 30, windowMs: 60_000 });
/**
 * A setting read from the environment: a whole number inside [min, max], otherwise the default. A value that is missing, not a plain whole number, zero, or out of bounds falls back to
 * the default, so a mistake in the host's settings can never switch a limit off.
 */
export function envInt(name: string, fallback: number, min: number, max: number, env: Record<string, string | undefined> = process.env): number {
  const raw = (env[name] ?? "").trim();
  if (!/^[0-9]{1,6}$/.test(raw)) return fallback;
  const n = Number(raw);
  return n >= min && n <= max ? n : fallback;
}

/**
 * The survey code page's two limits, a minute each: tries from ONE address for one survey (SURVEY_CODE_LIMIT_PER_MINUTE, default 30, 5 to 120) and a ceiling for ONE survey across every
 * address (SURVEY_CODE_LIMIT_PER_SURVEY_PER_MINUTE, default 600, 60 to 6,000), so many addresses cannot overload the page. The survey's ceiling is never lower than one address's allowance.
 * A code is 12 random characters (60 bits), so guessing is not feasible at either setting; the limits stop a program hammering the page and bound the database work.
 */
export function surveyCodeLimits(env: Record<string, string | undefined> = process.env): { perAddress: number; perSurvey: number } {
  const perAddress = envInt("SURVEY_CODE_LIMIT_PER_MINUTE", 30, 5, 120, env);
  const perSurvey = Math.max(envInt("SURVEY_CODE_LIMIT_PER_SURVEY_PER_MINUTE", 600, 60, 6000, env), perAddress);
  return { perAddress, perSurvey };
}
const codeLimits = surveyCodeLimits();
/** Someone typing survey access codes with no login (a QR code or a shared device): 30 tries a minute (configurable) for one survey from one address. */
export const surveyCodeLimiter = createLimiter({ limit: codeLimits.perAddress, windowMs: 60_000 });
/** One survey's code page across every address: 600 tries a minute (configurable). */
export const surveyCodeSurveyLimiter = createLimiter({ limit: codeLimits.perSurvey, windowMs: 60_000 });
/** A person downloading data (CSV exports, reports, data-request files): 10 in five minutes. */
export const exportLimiter = createLimiter({ limit: 10, windowMs: 5 * 60_000 });
/** A person sending email to contacts from the sales module: 60 an hour. */
export const emailSendLimiter = createLimiter({ limit: 60, windowMs: 60 * 60_000 });
