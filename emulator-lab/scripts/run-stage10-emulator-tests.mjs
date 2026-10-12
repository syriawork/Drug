/**
 * Runs the Stage 10 medicine-management suite against the REAL local emulators.
 *
 * Usage: npm run emulator:test:stage10
 *
 * WHY THIS SUITE EXISTS
 * The Windows medicines screen exposes exactly ONE administrative write. The unit
 * suites prove the client sends the right shape; THIS suite proves what the
 * Android `firestore.rules` actually answer, and - more importantly - what a
 * masked `maxQuantity` write leaves BEHIND. Nothing else in the project can show
 * that: the claim is about a document surviving a write, so it needs a real
 * engine rather than a fake repository.
 *
 * One case in this suite is deliberately destructive. It issues a raw mask-less
 * `PATCH` to DEMONSTRATE that Firestore replaces rather than merges a document,
 * then re-seeds the fixture. If that case ever fails, treat it as a change in
 * Firestore's documented behaviour rather than as a flaky test.
 *
 * It shares the SAME emulator ports as the Stage 3, Stage 5B, Stage 6 and Stage 9
 * runners, so the five must be run one at a time: a second `emulators:exec`
 * cannot bind 8080/9099, and the resulting failure looks like a broken
 * repository rather than a port collision.
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
  medicinesRulesTestFile,
  projectRoot,
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(medicinesRulesTestFile)) {
  console.error(`[lab] the compiled Stage 10 test is missing: ${medicinesRulesTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

const testCommand = `node --test "${medicinesRulesTestFile}"`;

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
  console.log(`[lab] Stage 10 medicine-management test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});