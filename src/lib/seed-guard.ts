/**
 * The seed guard. `prisma/seed.ts` TRUNCATES every table before loading the demo data, so run against a real database it would erase it. This decides, before anything is
 * touched, whether the seed may run against the database named by DATABASE_URL.
 *
 * Allowed as before: a database on this machine (localhost, 127.0.0.1, ::1) when NODE_ENV is not "production". Anything else is refused, unless the person has typed the
 * database's own name as a confirmation (SEED_CONFIRM_RESET=<database name>). A yes, a true or another database's name does not count: it has to be the name of the very
 * database about to be erased, so a command copied from one place cannot reset another.
 *
 * It never returns or prints the password, the user or the full address: only the database name and the host.
 */
export type SeedGuard = { ok: true; target: string; confirmed: boolean } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const bare = (host: string) => host.replace(/^\[|\]$/g, "").toLowerCase();

export function checkSeedTarget(env: Record<string, string | undefined>): SeedGuard {
  const raw = (env.DATABASE_URL ?? "").trim();
  if (!raw) return { ok: false, reason: "Refusing to reset: DATABASE_URL is not set, so the target database is unknown." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Refusing to reset: DATABASE_URL could not be read, so the target database is unknown." };
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const host = bare(url.hostname);
  const hostParam = url.searchParams.get("host");

  const reasons: string[] = [];
  if (env.NODE_ENV === "production") reasons.push("NODE_ENV is production");
  if (!LOCAL_HOSTS.has(host)) reasons.push(`the database host is ${host || "unknown"}, not this machine`);
  if (hostParam && !LOCAL_HOSTS.has(bare(hostParam))) reasons.push(`the connection is redirected to ${hostParam}, not this machine`);

  const where = `${name || "(no name)"} on ${host || "unknown host"}`;
  if (reasons.length === 0) return { ok: true, target: where, confirmed: false };
  if (name && env.SEED_CONFIRM_RESET === name) return { ok: true, target: where, confirmed: true };
  return {
    ok: false,
    reason:
      `Refusing to reset database "${name || "(no name)"}" on ${host || "unknown host"}: ${reasons.join("; ")}. The seed erases EVERY table. ` +
      (name ? `If you are certain this is the database to erase, run again with SEED_CONFIRM_RESET=${name}.` : `The database has no name in DATABASE_URL, so it cannot be confirmed.`),
  };
}

/** Returns what to print ("name on host") or throws the refusal. */
export function assertSeedTarget(env: Record<string, string | undefined>): string {
  const r = checkSeedTarget(env);
  if (!r.ok) throw new Error(r.reason);
  return r.target;
}
