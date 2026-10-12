/**
 * Runs the Stage 14 System Settings suite against the REAL local emulators.
 *
 * Usage: npm run emulator:test:stage13
 *
 * WHY THIS SUITE EXISTS
 * Stage 14 adds a PAGE, and no backend code: `FirestoreStockLogsRepository` and
 * the Stage 6 transaction that writes these rows both already existed. What no
 * fakes-based suite can answer is whether the REAL Android rules allow the read at
 * all - and `stock_logs` is one of the two collections firestore.rules restricts to
 * admins. This suite builds the Stage 14 application over the real repositories and
 * drives it through `application.manager.listStockMovements`, so the emulator itself
 * answers the only question that matters here: does an admin really see the trail,
 * and is an employee genuinely refused?
 *
 * It also pins the rules fingerprint, so a suite that "passed" against edited rules
 * would fail loudly instead of quietly proving something else.
 *
 * It shares the SAME emulator ports as the Stage 3, Stage 5B, Stage 6, Stage 9,
 * Stage 10, Stage 11, Stage 12 and Stage 13 runners, so the nine must be run one at
 * a time: a second `emulators:exec` cannot bind 8080/9099, and the resulting
 * failure looks like a broken repository rather than a port collision.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import {
  AUTH_EMULATOR_HOST,
  FIRESTORE_EMULATOR_HOST,
  LAB_PROJECT_ID,
  assertLabIsInstalled,
  firebaseCliPath,
  labFirebaseConfigPath,
  labRulesPath,
  projectRoot,
  stockLogsRulesTestFile,
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(stockLogsRulesTestFile)) {
  console.error(`[lab] the compiled Stage 14 test is missing: ${stockLogsRulesTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

const testCommand = `node --test "${stockLogsRulesTestFile}"`;

console.log(`[lab] starting the official emulators and running: ${testCommand}`);
console.log('[lab] ----------------------------------------------------------------');

const child = spawn(
  process.execPath,
  [
    firebaseCliPath,
    'emulators:exec',
    '--config',
    labFirebaseConfigPath,
    '--project',
    LAB_PROJECT_ID,
    '--only',
    'auth,firestore',
    testCommand,
  ],
  {
    stdio: 'inherit',
    cwd: projectRoot,
    env: {
      ...process.env,
      FIREBASE_PROJECT_ID: LAB_PROJECT_ID,
      DRUG_MANAGER_REQUIRE_FIRESTORE_EMULATOR: '1',
    },
  },
);

child.on('exit', (code, signal) => {
  console.log('[lab] ----------------------------------------------------------------');
  if (signal !== null) {
    console.error(`[lab] the emulator runner was terminated by signal ${signal}`);
    process.exit(1);
  }
  console.log(`[lab] Stage 14 stock-logs test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});