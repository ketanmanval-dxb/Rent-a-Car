# DriveEasy QA Report**PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS****PASS** (:3100)**PASS** (:3100; also verified 2 expired then 0)**PASS** (route handler + :3100)**PASS** (integration/webhooks.test.ts via route handler: 5x incl. 3 parallel -> 1 event row, 1 payment; dup refund/deposit events no-op). `pnpm fake-pay redeliver` blocked by B2**PASS** (:3100)**PASS** (:3100)**PASS** (B1 VERIFIED)**PASS** `pnpm build` (lint/typecheck: db reports clean)**PASS** (0 leaks, 6 secret vars checked)

Owner: **qa**. Last updated: 2026-10-30 (round 2: server layer D1-D11 tested; browser e2e pending app pages).

## How to run

| What | Command |
|---|---|
| Unit + integration (Vitest, `driveeasy_test` only) | `pnpm test` (global setup applies pending migrations to the test DB) |
| Same, from a clean test DB (drop schemas, migrate, seed) | `QA_FRESH_DB=1 pnpm test` |
| Reset test DB by hand | `pnpm exec tsx tests/scripts/reset-test-db.mts [--no-seed]` |
| E2E (Playwright: api, desktop-chromium, mobile-chromium, desktop-webkit) | `pnpm build`, then `DATABASE_URL=$TEST_DATABASE_URL DATABASE_URL_UNPOOLED=$TEST_DATABASE_URL pnpm start -p 3100` (background; keeps e2e off the dev DB), then `PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm test:e2e` (or omit PLAYWRIGHT_BASE_URL and Playwright starts it on the test DB) |
| Client bundle secret scan (prints var names only) | `pnpm build && pnpm exec tsx tests/scripts/scan-bundle.mts` |

Safety: the test DB helpers refuse any database whose name does not end in `_test`. Vitest forces
`DATABASE_URL`/`DATABASE_URL_UNPOOLED` to `TEST_DATABASE_URL`. Reset/migrate run under a Postgres
advisory lock so parallel runs (qa + db) don't collide. Integration tests create their own users and
use random far-future windows (2031-2095), so they never depend on each other or on seed bookings.
During Vitest, fake payment state and uploads go to a per-worker temp dir and webhooks are not POSTed.

## Test layout

| Path | Purpose |
|---|---|
| `tests/helpers/test-db.ts` | reset / migrate / seed `driveeasy_test`, query helpers, `_test` guard |
| `tests/helpers/contracts.ts` | the ONE place integration tests bind to db's server functions; missing functions make tests skip with "waiting on: ..." |
| `tests/helpers/fixtures.ts` | customers with driver profile + licence, admins, booking windows |
| `tests/global-setup.ts`, `tests/setup-env.ts` | Vitest global migrate / fresh reset; per-worker temp dirs |
| `tests/unit/*` | pure units (cron auth, fake payments, local storage, exclusion smoke) |
| `tests/integration/*` | real DB: auth, migrations/schema, parallel-transaction overlap, reservations, pricing, payments, authorization |
| `tests/e2e/api/*` | HTTP-only checks (cron secret, webhook signatures/dupes, private files) run once (project `api`) |
| `tests/e2e/*.spec.ts` | browser flows on desktop + mobile + webkit |
| `tests/scripts/*` | reset-test-db, scan-bundle |

## Test plan (requirement -> test cases)

Status: PASS / FAIL (bug id) / WAIT (written, skipped until feature lands) / TODO (not written yet) / BLOCKED.

### 1. Registration, login, logout, authorization
| # | Case | Where | Status |
|---|---|---|---|
| 1.1 | Register, log out, log in again | e2e/auth.spec.ts | WAIT (A2) |
| 1.2 | Wrong password rejected, generic message | e2e/auth.spec.ts | WAIT (A2) |
| 1.3 | Duplicate email rejected (case-insensitive, `users_email_lower_uq`) | e2e/auth.spec.ts | WAIT (A2) |
| 1.4 | Anonymous users redirected from /account, /rentals, /admin | e2e/smoke.spec.ts | WAIT (A1/A2, routes to confirm) |
| 1.5 | Customer cannot open /admin | e2e/auth.spec.ts | WAIT (A8) |
| 1.6 | Customer cannot call admin server functions | integration/authorization.test.ts | **PASS** |
| 1.6b | Server auth: sign-up creates customer with hashed password; role not self-assignable; duplicate email (case-insensitive) and short password rejected; sign-in right/wrong password | integration/auth.test.ts | **PASS** |
| 1.7 | Session cookie httpOnly + SameSite; logout invalidates session server-side | e2e (TODO) | TODO |

### 2. Search, branches, dates, filters, availability calendar
| # | Case | Where | Status |
|---|---|---|---|
| 2.1 | Home search form: pick-up branch, return branch, dates/times, search button | e2e/smoke.spec.ts | WAIT (A3) |
| 2.2 | Search excludes vehicles held/booked for the window, shows them for a later window | integration/reservations.test.ts | **PASS** |
| 2.3 | Filters: category, transmission, seats, fuel, price range, sort | integration (TODO) + e2e (TODO) | TODO |
| 2.4 | Validation: return before pick-up, past dates, > 90 days rejected | integration/reservations.test.ts, e2e (TODO) | **PASS** |
| 2.5 | Availability calendar marks booked/maintenance days | integration/reservations.test.ts | **PASS** |
| 2.6 | Times shown in branch time zone (Asia/Dubai), stored UTC | e2e (TODO) | TODO |
| 2.7 | Inactive branches not offered | integration (TODO) | TODO |

### 3. Complete rental: search -> payment -> voucher -> check-out -> return
| # | Case | Where | Status |
|---|---|---|---|
| 3.1 | Full customer flow to confirmation + voucher with reference + QR | e2e/rental.spec.ts | TODO (A5/A6) |
| 3.2 | Reservation PENDING with hold expiry ~HOLD_EXPIRY_MINUTES | integration/reservations.test.ts | **PASS** |
| 3.3 | Admin check-out (mileage, fuel) then check-in -> RETURNED, deposit released | integration/payments.test.ts, e2e/admin.spec.ts (TODO) | **PASS** |
| 3.4 | Reservation requires complete driver profile + licence | integration (TODO) | TODO |
| 3.5 | My rentals: modify dates (price difference), cancel with policy | integration (TODO), e2e (TODO) | TODO |

### 4. Concurrency and periods
| # | Case | Where | Status |
|---|---|---|---|
| 4.1 | Two parallel DB transactions, overlapping periods, same vehicle -> one commits, other 23P01 | integration/db-overlap.test.ts | **PASS** |
| 4.2 | Two parallel `createReservation` calls, overlapping -> exactly one ok, other UNAVAILABLE | integration/reservations.test.ts | **PASS** |
| 4.3 | Ten parallel attempts, identical dates -> exactly one, DB has one active row | integration/reservations.test.ts | **PASS** |
| 4.4 | Two browser sessions reserve at the same time over HTTP -> one wins | e2e/concurrency.spec.ts | TODO (A5) |
| 4.5 | Back-to-back (end == next start) succeeds, DB level | integration/db-overlap.test.ts | **PASS** |
| 4.6 | Back-to-back via app, sequential and concurrent | integration/reservations.test.ts | **PASS** |
| 4.7 | One-minute overlap rejected | integration/reservations.test.ts | **PASS** |
| 4.8 | Cancelled/expired frees slot; reactivation into a clash fails; date move into clash fails | integration/db-overlap.test.ts | **PASS** |
| 4.9 | Maintenance blocks vs reservations and vs each other | integration/db-overlap.test.ts (DB), reservations.test.ts (app) | **PASS** (DB + app) |
| 4.10 | Same period on a different vehicle allowed | integration/db-overlap.test.ts | **PASS** |

### 5. Expired holds and automatic release
| # | Case | Where | Status |
|---|---|---|---|
| 5.1 | Cron route 401 without / wrong / near-miss secret | e2e/api/security.spec.ts | **PASS** (:3100) |
| 5.2 | Cron route 200 twice in a row (idempotent) and 5x concurrently | e2e/api/security.spec.ts | **PASS** (:3100; verified 2 expired then 0) |
| 5.3 | `releaseExpiredHolds` flips stale PENDING -> EXPIRED, second run no-op, slot free | integration/reservations.test.ts | **PASS** |
| 5.4 | Unexpired holds untouched | integration/reservations.test.ts | **PASS** |
| 5.5 | Expired-but-not-yet-released hold does not block a new booking (released inside the reservation transaction) | integration/reservations.test.ts | **PASS** |
| 5.6 | Paying after hold expiry refused, nothing charged | integration/payments.test.ts | **PASS** |
| 5.7 | `isAuthorizedCronRequest` exact bearer match, unset secret denies | unit/cron-auth.test.ts | **PASS** |

### 6. Pricing (daily rate, extras, one-way, VAT 5%, late return, deposit)
| # | Case | Where | Status |
|---|---|---|---|
| 6.1 | base = days x daily; subtotal = base + extras + one-way (+ location fee); VAT = round(5%); total = subtotal + VAT; all integer fils | integration/pricing.test.ts | **PASS** |
| 6.2 | Day counting: 24h = 1, 48h = 2, 51h = 3 | integration/pricing.test.ts | **PASS** |
| 6.3 | Search price == quote price | integration/pricing.test.ts | **PASS** |
| 6.4 | Per-day extras x qty x days; per-rental extras flat; invalid qty / unknown extra rejected | integration/pricing.test.ts | **PASS** |
| 6.5 | One-way fee only when return branch differs | integration/pricing.test.ts | **PASS** |
| 6.6 | Reservation stores server price; client-supplied prices ignored | integration/pricing.test.ts | **PASS** |
| 6.7 | Pricing rules (seasonal, weekend, duration discount) applied | integration (TODO, needs D5 rule semantics) | TODO |
| 6.8 | Late-return charge (late_fee_per_hour x hours, grace policy) on check-in | integration (TODO) | TODO |
| 6.9 | Deposit = category deposit, held at payment, shown in breakdown | integration/payments.test.ts | **PASS** |
| 6.10 | DB checks: subtotal/total sum, non-negative money, AED only | integration/migrations.test.ts (integer money) | **PASS** (partial) |

### 7. Payments and deposits
| # | Case | Where | Status |
|---|---|---|---|
| 7.1 | Success confirms only after charge AND deposit hold | integration/payments.test.ts | **PASS** |
| 7.2 | Failure keeps PENDING with failure reason | integration/payments.test.ts | **PASS** |
| 7.3 | Cancellation at checkout does not confirm | integration/payments.test.ts | **PASS** |
| 7.4 | Retry with new attempt after failure succeeds | integration/payments.test.ts | **PASS** |
| 7.5 | Same attempt twice in parallel -> one SUCCEEDED payment | integration/payments.test.ts | **PASS** |
| 7.6 | Pay again after paid -> ALREADY_PAID | integration/payments.test.ts | **PASS** |
| 7.7 | Cancel confirmed -> refund per policy, deposit released, no double refund | integration/payments.test.ts | **PASS** |
| 7.8 | Webhook rejects unsigned / forged / stale signature | e2e/api/security.spec.ts | **PASS** (route handler + :3100) |
| 7.9 | Duplicate webhook delivery (same event id) accepted, processed once | integration/webhooks.test.ts, e2e/api/security.spec.ts | **PASS** (5x incl. 3 parallel -> 1 event row, 1 payment; dup refund/deposit events no-op). `pnpm fake-pay redeliver` blocked by B2 |
| 7.10 | Deposit capture on damage, rest released | integration (TODO) | TODO |
| 7.11 | Fake provider: idempotency, refunds, deposits, signatures, redelivery | unit/fake-payments.test.ts | **PASS** |

### 8. Isolation between users
| # | Case | Where | Status |
|---|---|---|---|
| 8.1 | Another user can't read / list / cancel / modify / pay someone's reservation | integration/authorization.test.ts | **PASS** |
| 8.2 | Another user's voucher page returns 404/403 | e2e/isolation.spec.ts | TODO (A6) |
| 8.3 | Another user's licence file route returns 403/404; admin can view | e2e/isolation.spec.ts | TODO (D10) |
| 8.4 | Anonymous requests to /api/files, /api/reservations, /api/admin not 200 | e2e/api/security.spec.ts | **PASS** (:3100) |
| 8.5 | Upload dirs, fake-payment state, .env files not reachable as static files | e2e/api/security.spec.ts | **PASS** (:3100) |
| 8.6 | Storage refuses /public and path traversal | unit/local-storage.test.ts | **PASS** |

### 9. Admin permissions
| # | Case | Where | Status |
|---|---|---|---|
| 9.1 | Fleet CRUD, pricing CRUD, check-in, damage reports: admin ok, customer denied | integration/authorization.test.ts (partial), e2e/admin.spec.ts (TODO) | partial PASS (customer denied check-out/in/list) / TODO e2e |
| 9.2 | Every admin state change writes audit_logs; audit_logs append-only | integration (TODO) | TODO |
| 9.3 | Damage report images private (owner/admin route only) | e2e (TODO) | TODO |

### 10. Migrations, build, deployment
| # | Case | Where | Status |
|---|---|---|---|
| 10.1 | All migrations apply on a clean DB (`QA_FRESH_DB=1`) and journal count matches | integration/migrations.test.ts | **PASS** |
| 10.2 | Schema: domain tables, uuid PKs, exclusion constraints, unique plate/VIN/branch code, enums, integer money, timestamptz only, FKs | integration/migrations.test.ts | **PASS** (B1 VERIFIED) |
| 10.3 | Seed runs on the clean test DB | global-setup (QA_FRESH_DB=1) | **PASS** |
| 10.4 | `pnpm build` passes; `pnpm lint`, `pnpm typecheck` clean | manual | **PASS** `pnpm build` |
| 10.5 | No server secrets in `.next/static` | scripts/scan-bundle.mts | **PASS** (0 leaks, 6 secret vars checked) |
| 10.6 | Vercel preview / production builds, deployed e2e | - | **BLOCKED** (no cloud accounts yet, X1) |

### 11. Layouts
| # | Case | Where | Status |
|---|---|---|---|
| 11.1 | Home renders, no console errors, no horizontal overflow on desktop / Pixel 7 / Safari | e2e/smoke.spec.ts | WAIT (A1) |
| 11.2 | Every main page (search, details, booking, voucher, my rentals, admin) no overflow on mobile; nav usable via menu | e2e (TODO) | TODO |

## Results log

### Run 1 (2026-10-30, phase 1)
- Vitest: 39 passed, 1 failed (B1), 35 skipped (waiting on server functions). Clean-DB migration run (`QA_FRESH_DB=1`) passes.
- E2E: not run yet (no app pages / API routes). 28 tests listed across 4 projects.

### Run 2 (2026-10-30, D1-D11 landed)
- `QA_FRESH_DB=1 pnpm test`: clean DB, 4 migrations, seed OK; **118/118 pass** (incl. db's own 37). Full suite repeated 7x: stable.
- Fixed my test-side issues found on first run: unscoped active-row count, adjacent derived windows colliding with earlier bookings (pickVehicle now requires a 4-day free margin), admin input field `mileageKm`, lenient HOLD_EXPIRY_MINUTES parse (see B2), DB-level race loser may be 40P01 (deadlock) as well as 23P01. Added integration/webhooks.test.ts.
- `pnpm build`: PASS (notes to db: licence/me route logs a swallowed prerender bail-out; Turbopack whole-project trace warning from payments/provider.ts).
- Secret scan of .next/static: 0 leaks.
- Playwright `api` project on :3100 (test DB): **7/7 pass**. Browser specs (auth, smoke) not run this round: per lead, app pages still in progress.

## Bugs
See TASKS.md Bugs section (source of truth). Summary:
- B1 [db] VERIFIED, low: reservations FKs `return_branch_id`, `driver_profile_id` lacked an index (fixed in 0003).
- B2 [lead] OPEN, medium: `.env.local` line 28 merges HOLD_EXPIRY_MINUTES and FAKE_PAYMENT_WEBHOOK_URL (no local webhook delivery; `pnpm fake-pay redeliver` fails).

## Blocked
- Vercel preview/production builds and deployed e2e: BLOCKED until the owner provides cloud accounts (X1).
