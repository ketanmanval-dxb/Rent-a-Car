# DriveEasy

Car rental web app for UAE branches: search and book vehicles, pay with a refundable security deposit, get a QR pick-up voucher, and manage the fleet, pricing, check-out/check-in and damage reports as an admin.

**Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, PostgreSQL + Drizzle ORM, Better Auth (email + password), Zod, Vitest, Playwright. Package manager: pnpm.

## Local setup

Prerequisites: Node.js 26 LTS, pnpm 12, PostgreSQL 18 (with the `btree_gist` extension available), Git.

1. Install dependencies:
   ```sh
   pnpm install
   pnpm exec playwright install   # browsers for e2e tests
   ```
2. Create the databases (as the `postgres` superuser):
   ```sql
   CREATE ROLE driveeasy LOGIN PASSWORD '<choose-a-password>';
   CREATE DATABASE driveeasy_dev  OWNER driveeasy;
   CREATE DATABASE driveeasy_test OWNER driveeasy;
   \c driveeasy_dev
   CREATE EXTENSION btree_gist;
   \c driveeasy_test
   CREATE EXTENSION btree_gist;
   ```
3. Copy `.env.example` to `.env.local` and fill it in (see [Environment variables](#environment-variables)). Generate secrets with `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Apply migrations and load sample data:
   ```sh
   pnpm db:migrate
   pnpm db:seed
   ```
5. Run the app at http://localhost:3000:
   ```sh
   pnpm dev
   ```

Seeded local accounts (local/dev databases only, never production):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@driveeasy.local` | `Admin@12345` |
| Customer | `customer@driveeasy.local` | `Customer@12345` |

The seed adds 5 branches (Dubai Airport, Dubai Marina, Downtown Dubai, Abu Dhabi, Sharjah), 6 categories, 21 vehicles, extras, pricing rules, one-way fees and some future reservations.

## Local stand-ins for cloud services

Each cloud service sits behind an interface, selected by an environment variable, so switching to the real service is a configuration change plus one adapter.

| Concern | Local (default) | Production | Code |
|---|---|---|---|
| Payments | `PAYMENT_PROVIDER=fake`: test-mode charges, refunds, deposit holds/release/capture, signed webhooks (including duplicate delivery) | A real provider in test mode (adapter to add) | `src/server/payments/` |
| File storage | `STORAGE_PROVIDER=local`: private `storage/uploads/` folder outside `public/` | `vercel-blob` (adapter to add) | `src/server/storage/` |
| Scheduled jobs | `pnpm cron` calls the cron routes with `Bearer $CRON_SECRET` | Vercel Cron (`vercel.json`) | `src/server/cron/` |
| Database | Local PostgreSQL | Neon (Vercel Marketplace) | `src/server/db/` |

Useful commands:

```sh
pnpm cron                          # run scheduled jobs once (app must be running)
pnpm cron --watch                  # keep running them on their local interval
pnpm fake-pay events               # list fake payment webhook events
pnpm fake-pay redeliver <id> 3     # re-send an event 3 times (duplicate-webhook testing)
pnpm fake-pay reset                # clear fake payment state
```

At checkout the fake provider shows test controls to make a payment succeed, fail or be cancelled.

## Environment variables

All variables are listed in [.env.example](.env.example). Everything is server-side; only `NEXT_PUBLIC_*` values reach the browser, and no secret may use that prefix.

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | yes | Public base URL |
| `DATABASE_URL` | yes | App connection. On Neon use the **pooled** URL |
| `DATABASE_URL_UNPOOLED` | prod | Direct connection, used only by migrations |
| `TEST_DATABASE_URL` | tests | Separate test database (tests may wipe it) |
| `DATABASE_POOL_MAX` | no | Pool size (default 10) |
| `BETTER_AUTH_SECRET` | yes | Session signing secret (32+ random bytes) |
| `BETTER_AUTH_URL` | yes | Usually equal to `APP_URL` |
| `PAYMENT_PROVIDER` | yes | `fake` (local) or the real provider |
| `FAKE_PAYMENT_WEBHOOK_SECRET` | fake | HMAC secret for fake webhooks |
| `FAKE_PAYMENT_WEBHOOK_URL` | fake | Where fake webhooks are sent (`<APP_URL>/api/webhooks/payments`) |
| `FAKE_PAYMENT_STATE_FILE` | no | Fake provider state file |
| `FAKE_PAYMENT_WEBHOOK_DELIVERIES` | no | Send each webhook N times (2+ tests duplicates) |
| `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET` | real provider | Payment provider keys (test mode first) |
| `STORAGE_PROVIDER` | yes | `local` or `vercel-blob` |
| `LOCAL_UPLOADS_DIR` | local | Private uploads folder (default `./storage/uploads`) |
| `BLOB_READ_WRITE_TOKEN` | Blob | Vercel Blob token |
| `CRON_SECRET` | yes | Bearer token required by `/api/cron/*` |
| `HOLD_EXPIRY_MINUTES` | no | Reservation hold lifetime (default 15) |
| `BOOKING_MAX_ADVANCE_DAYS` | no | How far ahead customers can book (default 365) |
| `LOG_LEVEL` | no | `debug`, `info`, `warn` or `error` (default `info`) |

## Database and migrations

- The schema lives in `src/server/db/schema/` and migrations in `drizzle/`.
- After changing the schema: `pnpm db:generate` creates a migration, then commit it and run `pnpm db:migrate`.
- Migrations use `DATABASE_URL_UNPOOLED` when it is set, otherwise `DATABASE_URL`.
- `pnpm db:studio` opens Drizzle Studio.

Key rules enforced by the database:

- UUID keys; timestamps are `timestamptz` (UTC) and shown in each branch's time zone.
- Money is stored as integer fils (AED minor units).
- Rental periods are half-open ranges `[start, end)`.
- Active reservations and maintenance blocks are copied into `vehicle_occupancy`. That table's exclusion constraint makes it impossible for one vehicle to have overlapping bookings or blocks. Back-to-back rentals are allowed.
- Reservations are created in a transaction that locks the vehicle row, checks availability, places a hold that expires, and prices the rental on the server. A reservation is confirmed only after both the payment and the deposit hold succeed. Idempotency keys stop retries from charging twice.
- Expired holds are released by `GET /api/cron/release-expired-holds`, which is idempotent and protected by `CRON_SECRET`.

## Testing

```sh
pnpm typecheck
pnpm lint
pnpm test                    # Vitest: unit + integration against TEST_DATABASE_URL
QA_FRESH_DB=1 pnpm test      # rebuild the test DB from empty (migrations + seed) first
```

End-to-end tests run against a production build on port 3100, using the test database:

```sh
pnpm build
pnpm test:e2e                # starts `pnpm start -p 3100` automatically
PLAYWRIGHT_BASE_URL=https://<preview-url> pnpm test:e2e   # test a deployed URL
```

Playwright projects: `api` (security checks), `desktop-chromium`, `mobile-chromium`, `desktop-webkit`. See [QA_REPORT.md](QA_REPORT.md) for the test plan and latest results.

## Deploying to Vercel

1. **Import the GitHub repo** into Vercel. The framework preset is Next.js and the build command is `pnpm build`.
2. **Database:** in the project, go to Storage → Marketplace → **Neon** and create a database, then connect it to both Production and Preview. This adds `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`. Neon can create a separate branch database per preview deployment.
3. **Files:** go to Storage → **Blob**, create a store and connect it. This adds `BLOB_READ_WRITE_TOKEN`. Then set `STORAGE_PROVIDER=vercel-blob`. Licence images must be stored with private access.
4. **Environment variables** (Settings → Environment Variables). Use different values for Production and Preview, and never reuse local secrets:
   - `APP_URL`, `BETTER_AUTH_URL`: the deployment URL
   - `BETTER_AUTH_SECRET`, `CRON_SECRET`: new random values
   - `PAYMENT_PROVIDER` plus the provider's test keys (`PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`)
   - `HOLD_EXPIRY_MINUTES`, `BOOKING_MAX_ADVANCE_DAYS`, `LOG_LEVEL` as needed
5. **Migrations on deploy:** set the build command to `pnpm db:migrate && pnpm build`. Migrations then run against `DATABASE_URL_UNPOOLED` for each environment before the new version goes live. Drizzle migrations are applied in order and recorded, so re-running them is safe.
6. **Payment webhooks:** in the payment provider's dashboard, point the webhook to `https://<domain>/api/webhooks/payments` and copy its signing secret into `PAYMENT_WEBHOOK_SECRET`.
7. **Cron:** `vercel.json` schedules `/api/cron/release-expired-holds` every 5 minutes. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
   - **The Hobby plan only allows daily cron jobs, and a deployment with a more frequent schedule fails.** On Hobby, change the schedule to daily (holds that have expired never block bookings anyway; the cron only tidies them up) or use a Pro plan.
8. **Upload size:** Vercel Functions accept request bodies up to 4.5 MB, so uploads are capped at 4 MB per file and sent one file per request.
9. **Verify:** run the Playwright suite against the preview URL, then promote to production.

## Project layout

```
src/app/            pages, layouts, server actions (app/api = route handlers)
src/components/     UI components
src/lib/            client-safe helpers (formatting, time zones)
src/server/         server-only code: db, auth, catalog, pricing, reservations,
                    payments, storage, cron, admin, files, logging
drizzle/            SQL migrations
scripts/            seed, cron runner, fake payment CLI
tests/              unit, integration, e2e, helpers
```
