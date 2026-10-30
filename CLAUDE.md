@AGENTS.md

# DriveEasy

Car rental web app (AED, UAE branches). Next.js 16 App Router + TypeScript, Tailwind 4,
Drizzle ORM on PostgreSQL, Better Auth (email + password), Zod, Vitest, Playwright. pnpm only.

## Local-first rule (current phase)

- Everything runs locally. Do not create, log in to, or deploy to any cloud account
  (Vercel, Neon, Vercel Blob, Stripe, etc.) until the owner provides the links/credentials.
- Deployment tasks stay blocked until then; the project is not complete until it is deployed.
- Cloud services sit behind interfaces chosen by env vars, so switching is config-only:

| Concern | Interface | Local stand-in (now) | Cloud (later) |
|---|---|---|---|
| Payments | `src/server/payments/types.ts` → `getPaymentProvider()` | `PAYMENT_PROVIDER=fake` (JSON state in `storage/fake-payments/`) | `stripe` (test mode) |
| Files | `src/server/storage/types.ts` → `getStorage()` | `STORAGE_PROVIDER=local` (`storage/uploads/`, outside `public/`) | `vercel-blob` |
| Cron | `src/server/cron/jobs.ts` + `isAuthorizedCronRequest()` | `pnpm cron [--watch]` calls routes with `Bearer $CRON_SECRET` | Vercel Cron via `vercel.json` |
| Database | `DATABASE_URL` | local PostgreSQL 18 (`driveeasy_dev`, `driveeasy_test`, btree_gist installed) | Neon pooled URL; migrations use `DATABASE_URL_UNPOOLED` |

## Commands

- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck`
- `pnpm test` (Vitest, uses `TEST_DATABASE_URL`, never the dev DB) / `pnpm test:e2e` (Playwright, desktop + mobile)
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` (schema lives in `src/server/db/schema/`, migrations in `drizzle/`)
- `pnpm cron` — run scheduled jobs once against the local app
- `pnpm fake-pay events | redeliver <eventId> [n] | reset` — inspect and replay fake payment webhooks

## Conventions

- Server-only code lives in `src/server/`. Never import it from client components; never expose
  secrets via `NEXT_PUBLIC_*`.
- Money is integer minor units (fils). Timestamps are stored in UTC (`timestamptz`), displayed in the branch time zone.
- Rental periods are half-open `tstzrange` `[start, end)` so back-to-back rentals don't collide.
- Fake payment webhooks are signed (`x-driveeasy-signature`, HMAC-SHA256 like Stripe) and may arrive
  more than once with the same event id. Handlers must verify and dedupe by event id.
- Licence uploads are private: serve them only through a route that checks the owner or an admin.
- Local secrets are in `.env.local` (gitignored). Every variable is listed in `.env.example`; keep it in sync.
