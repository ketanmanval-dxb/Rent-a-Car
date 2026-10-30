// Vitest global setup: bring driveeasy_test up to date before integration tests.
//   default          apply pending migrations (safe while other agents also run tests)
//   QA_FRESH_DB=1    drop everything, migrate from clean and seed (proves clean-DB migrations)
import { freshTestDb, hasMigrations, migrateTestDb } from "./helpers/test-db";

export default async function setup() {
  if (!process.env.TEST_DATABASE_URL || !hasMigrations()) return;
  if (process.env.QA_FRESH_DB === "1") {
    console.log("[qa] fresh test DB:", await freshTestDb());
  } else {
    await migrateTestDb();
  }
}
