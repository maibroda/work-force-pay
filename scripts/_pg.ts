/**
 * Postgres helpers for the backup scripts. Uses the local `pg_dump` / `pg_restore` / `psql` when they are installed,
 * otherwise the same tools inside the database's Docker container (WFP_DB_CONTAINER, default "workforcepay-db").
 * The password is passed through the environment, never on a command line, and is never printed.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";

export interface Conn {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export function parseUrl(url: string): Conn {
  const u = new URL(url);
  return { host: u.hostname, port: u.port || "5432", user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, "") };
}

export const withDatabase = (url: string, database: string) => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
};

export const container = () => process.env.WFP_DB_CONTAINER ?? "workforcepay-db";
const hasLocal = (tool: string) => spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
export const mode = (): "local" | "docker" => (hasLocal("pg_dump") && hasLocal("pg_restore") && hasLocal("psql") ? "local" : "docker");

/** The command and arguments that run `tool args…` against this connection. */
function invoke(c: Conn, tool: string, args: string[], extraDocker: string[] = []) {
  if (mode() === "local") return { cmd: tool, args: ["-h", c.host, "-p", c.port, "-U", c.user, ...args], env: { ...process.env, PGPASSWORD: c.password } };
  return { cmd: "docker", args: ["exec", ...extraDocker, "-e", `PGPASSWORD=${c.password}`, container(), tool, "-U", c.user, ...args], env: process.env };
}

export function sql(c: Conn, database: string, statement: string): string {
  const { cmd, args, env } = invoke(c, "psql", ["-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", statement]);
  return execFileSync(cmd, args, { env, encoding: "utf8" }).trim();
}

/** Writes a custom-format dump of the database to `file`. */
export function dumpTo(c: Conn, file: string): Promise<void> {
  const { cmd, args, env } = invoke(c, "pg_dump", ["-Fc", "-d", c.database]);
  const out = fs.createWriteStream(file);
  const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => (err += String(d)));
  p.stdout.pipe(out);
  // Both must finish: the tool exiting cleanly, and every byte flushed to the file.
  const written = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    p.on("error", reject);
    p.on("close", resolve);
  });
  return Promise.all([exited, written]).then(([code]) => {
    if (code !== 0) throw new Error(`pg_dump failed (${code}): ${err.trim()}`);
  });
}

/** Restores a dump into `target` (which must already exist and be empty). */
export function restoreInto(c: Conn, file: string, target: string) {
  if (mode() === "local") {
    const { cmd, args, env } = invoke(c, "pg_restore", ["--no-owner", "-d", target, file]);
    execFileSync(cmd, args, { env, stdio: "pipe" });
    return;
  }
  const inside = "/tmp/wfp-restore-check.dump";
  execFileSync("docker", ["cp", file, `${container()}:${inside}`]);
  try {
    const { cmd, args, env } = invoke(c, "pg_restore", ["--no-owner", "-d", target, inside]);
    execFileSync(cmd, args, { env, stdio: "pipe" });
  } finally {
    execFileSync("docker", ["exec", container(), "rm", "-f", inside]);
  }
}
