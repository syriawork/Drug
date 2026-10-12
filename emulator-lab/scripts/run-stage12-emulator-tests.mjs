/**
 * Runs the Stage 12 Orders History suite against the REAL local emulators.
 *
 * Usage: npm run emulator:test:stage12
 *
 * WHY THIS SUITE EXISTS
 * Stage 12 adds one READ, and a unit test over fakes cannot say whether the REAL
 * Android rules would allow it. This suite builds the Stage 12 application over the
 * real repositories and drives it through `application.manager.listOrders`, so the
 * only two questions that matter get answered by the emulator itself: does an admin
 * really see every order, and is an employee's unfiltered list genuinely refused.
 *
 * It also pins the rules fingerprint, so a suite that "passed" against edited rules
 * would fail loudly instead of quietly proving something else.
 *
 * It shares the SAME emulator ports as the Stage 3, Stage 5B, Stage 6, Stage 9,
 * Stage 10 and Stage 11 runners, so the seven must be run one at a time: a second
 * `emulators:exec` cannot bind 8080/9099, and the resulting failure looks like a
 * broken repository rather than a port collision.
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
  ordersHistoryRulesTestFile,
  projectRoot,
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(ordersHistoryRulesTestFile)) {
  console.error(`[lab] the compiled Stage 12 test is missing: ${ordersHistoryRulesTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

const testCommand = `node --test "${ordersHistoryRulesTestFile}"`;

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
  console.log(`[lab] Stage 12 orders-history test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});