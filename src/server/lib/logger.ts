// Structured server logs: one JSON object per line on stdout/stderr.
// Never log secrets, card data, passwords or licence contents.

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = (): number => LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, code: (err as { code?: string }).code, stack: err.stack };
  }
  return { message: String(err) };
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel()) return;
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS && level !== "error") return;
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg, service: "driveeasy" };
  for (const [k, v] of Object.entries(fields ?? {})) {
    entry[k] = k === "err" || v instanceof Error ? serializeError(v) : v;
  }
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function make(bindings: Record<string, unknown>): Logger {
  const w = (level: Level) => (msg: string, fields?: Record<string, unknown>) => write(level, msg, { ...bindings, ...fields });
  return {
    debug: w("debug"),
    info: w("info"),
    warn: w("warn"),
    error: w("error"),
    child: (more) => make({ ...bindings, ...more }),
  };
}

export const logger: Logger = make({});
