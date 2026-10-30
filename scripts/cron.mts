// Local stand-in for Vercel Cron. Calls each protected cron route with the
// CRON_SECRET bearer token, exactly as Vercel would.
//
//   pnpm cron                              run every job once
//   pnpm cron release-expired-holds        run one job once
//   pnpm cron --watch                      keep running on each job's local interval

import { cronJobs, type CronJob } from "../src/server/cron/jobs";

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set (expected in .env.local)");
  process.exit(1);
}

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const names = args.filter((a) => !a.startsWith("--"));
const jobs = names.length ? cronJobs.filter((j) => names.includes(j.name)) : cronJobs;
const unknown = names.filter((n) => !cronJobs.some((j) => j.name === n));
if (unknown.length) {
  console.error(`Unknown job(s): ${unknown.join(", ")}. Known: ${cronJobs.map((j) => j.name).join(", ")}`);
  process.exit(1);
}

async function run(job: CronJob): Promise<boolean> {
  const started = Date.now();
  try {
    const res = await fetch(new URL(job.path, baseUrl), { headers: { authorization: `Bearer ${secret}` } });
    const body = await res.text();
    console.log(JSON.stringify({ job: job.name, status: res.status, ms: Date.now() - started, body: body.slice(0, 500) }));
    return res.ok;
  } catch (err) {
    console.log(JSON.stringify({ job: job.name, error: `Could not reach ${baseUrl} (is \`pnpm dev\` running?)`, detail: String(err) }));
    return false;
  }
}

if (watch) {
  for (const job of jobs) {
    void run(job);
    setInterval(() => void run(job), job.localEverySeconds * 1000);
  }
} else {
  const results = await Promise.all(jobs.map(run));
  process.exit(results.every(Boolean) ? 0 : 1);
}
