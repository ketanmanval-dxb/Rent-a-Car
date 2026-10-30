// Scheduled jobs. Each job is a protected route handler. Locally, `pnpm cron`
// calls these routes on a timer; on Vercel the same paths go in vercel.json "crons"
// and Vercel calls them with `Authorization: Bearer $CRON_SECRET`.

export interface CronJob {
  name: string;
  path: string;
  /** Cron expression for vercel.json. */
  schedule: string;
  /** Interval for the local runner. */
  localEverySeconds: number;
}

export const cronJobs: CronJob[] = [
  {
    name: "release-expired-holds",
    path: "/api/cron/release-expired-holds",
    schedule: "0 0 * * *",
    localEverySeconds: 60,
  },
];
