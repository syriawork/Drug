/**
 * Runs the Stage 11 Order Requests suite against the REAL local emulators.
 *
 * Usage: npm run emulator:test:stage11
 *
 * WHY THIS SUITE EXISTS
 * Stages 6, 9 and 10 each prove one layer against the real Android rules. Stage
 * 11 is the first stage whose claim is about a USER INTERFACE rather than a
 * service, so it needs its own emulator run: the suite builds the whole Stage 11
 * application over the real repositories and the real Stage 6 engine, and drives
 * it through `application.orderRequests`. A unit suite over fakes cannot show
 * whether the rules would actually let a manager process a request, nor whether
 * an employee is stopped - and those are the only two questions that matter
 * here.
 *
 * It also pins the rules fingerprint, so a suite that "passed" against edited
 * rules would fail loudly instead of quietly proving something else.
 *
 * One case per outcome is destructive by design: each section seeds and asserts
 * on real documents rather than mocking a repository response.
 *
 * It shares the SAME emulator ports as the Stage 3, Stage 5B, Stage 6, Stage 9
 * and Stage 10 runners, so the six must be run one at a time: a second
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
  orderRequestsRulesTestFile,
  projectRoot,
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(orderRequestsRulesTestFile)) {
  console.error(`[lab] the compiled Stage 11 test is missing: ${orderRequestsRulesTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

const testCommand = `node --test "${orderRequestsRulesTestFile}"`;

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
  console.log(`[lab] Stage 11 order-requests test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});