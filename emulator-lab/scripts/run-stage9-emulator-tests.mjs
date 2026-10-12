/**
 * Runs the Stage 9 user-management suite against the REAL local emulators.
 *
 * Usage: npm run emulator:test:stage9
 *
 * WHY THIS SUITE EXISTS
 * The Windows users screen exposes five administrative writes. The unit suites
 * prove the client sends the right shape; THIS suite proves what the Android
 * `firestore.rules` actually answer - that an admin and an assistant may write,
 * that an employee is refused every one of them, and that a masked write leaves
 * the `lastOrder*` summary intact.
 *
 * It shares the SAME emulator ports as the Stage 3, Stage 5B and Stage 6
 * runners, so the four must be run one at a time: a second `emulators:exec`
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
  usersRulesTestFile,
  projectRoot,
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(usersRulesTestFile)) {
  console.error(`[lab] the compiled Stage 9 test is missing: ${usersRulesTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

const testCommand = `node --test "${usersRulesTestFile}"`;

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
  console.log(`[lab] Stage 9 user-management test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});