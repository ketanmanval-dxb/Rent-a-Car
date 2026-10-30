// Reset driveeasy_test from clean: drop schemas -> run ./drizzle migrations -> seed.
//
//   pnpm exec tsx tests/scripts/reset-test-db.mts            reset + migrate + seed
//   pnpm exec tsx tests/scripts/reset-test-db.mts --no-seed  reset + migrate only
//
// Refuses to run on any database whose name does not end in _test.

import { freshTestDb } from "../helpers/test-db";

const seed = !process.argv.includes("--no-seed");
const started = Date.now();
const result = await freshTestDb({ seed });
console.log(JSON.stringify({ ...result, ms: Date.now() - started }));
