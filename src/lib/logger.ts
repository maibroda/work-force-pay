import "server-only";

type Level = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

function serialize(meta?: Meta) {
  if (!meta) return undefined;
  const out: Meta = {};
  for (const [k, v] of Object.entries(meta))
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  return out;
}

/** One JSON line per event to stdout/stderr — pipe to any log aggregator (CloudWatch, Datadog, etc.). */
function emit(level: Level, message: string, meta?: Meta) {
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...serialize(meta) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, meta?: Meta) => emit("debug", message, meta),
  info: (message: string, meta?: Meta) => emit("info", message, meta),
  warn: (message: string, meta?: Meta) => emit("warn", message, meta),
  error: (message: string, meta?: Meta) => emit("error", message, meta),
};
