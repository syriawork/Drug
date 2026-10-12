/**
 * Runs the Stage 5B repository suite against the REAL local emulators.
 *
 * Usage: npm run emulator:test:repositories
 *
 * WHY A SCRIPT INSTEAD OF BARE `node --test`
 * The repository suite needs a LIVE Firestore, so it has to run inside
 * `firebase emulators:exec` - the process has to be started after the emulators
 * are up and torn down with them. `npm run test:emulator:repositories` skips the
 * emulator entirely and would silently test nothing; this script is the one that
 * actually exercises the repository against a real engine.
 *
 * It deliberately reuses the SAME lab ports as the Stage 3 and Stage 6 runners.
 * All three therefore have to be run one at a time, never concurrently: a second
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
  projectRoot,
  repositoriesTestFile,
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(repositoriesTestFile)) {
  console.error(`[lab] the compiled repository test is missing: ${repositoriesTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

const testCommand = `node --test "${repositoriesTestFile}"`;

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
  console.log(`[lab] repository test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});
