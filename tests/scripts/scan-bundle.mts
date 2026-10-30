// Scan the client bundle (.next/static) for server secret values from .env.local.
// Prints only variable NAMES that leaked, never the values. Exit 1 on any leak.
//
//   pnpm build && pnpm exec tsx tests/scripts/scan-bundle.mts

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const env = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};
const SECRET_NAME = /SECRET|PASSWORD|TOKEN|DATABASE_URL|_KEY$/;
const secrets = Object.entries(env).filter(([k, v]) => SECRET_NAME.test(k) && !k.startsWith("NEXT_PUBLIC_") && v.length >= 8);

const dirs = [".next/static"];
const files = dirs.filter(existsSync).flatMap(walk);
if (!files.length) {
  console.error("No .next/static found: run `pnpm build` first");
  process.exit(2);
}

const leaks = new Set<string>();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const [k, v] of secrets) {
    // Also catch the password part of connection strings on its own.
    const needles = [v, ...(k.includes("DATABASE_URL") ? [safeUrlPassword(v)] : [])].filter((n): n is string => !!n && n.length >= 8);
    if (needles.some((n) => text.includes(n))) leaks.add(`${k} in ${path.relative(".", f)}`);
  }
}
console.log(JSON.stringify({ scannedFiles: files.length, checkedVars: secrets.map(([k]) => k), leaks: [...leaks] }, null, 2));
process.exit(leaks.size ? 1 : 0);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(js|css|html|json|txt|map)$/.test(n) ? [p] : [];
  });
}

function parseEnv(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function safeUrlPassword(u: string): string | undefined {
  try {
    return decodeURIComponent(new URL(u).password) || undefined;
  } catch {
    return undefined;
  }
}
