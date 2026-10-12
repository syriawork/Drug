/**
 * Runs the Stage 13 System Settings suite against the REAL local emulators.
 *
 * Usage: npm run emulator:test:stage13
 *
 * WHY THIS SUITE EXISTS
 * Stage 13 adds a PAGE and no backend code, so the fakes-based suites can only prove
 * what the renderer does with a payload. They cannot say whether the REAL Android
 * rules would let the read happen at all. This suite builds the Stage 13 application
 * over the real repositories and drives it through `application.manager.getSettings`,
 * so the emulator itself answers the two questions that matter: is a stored document
 * read exactly as stored, and is a missing document reported as missing rather than
 * quietly replaced by the fallbacks the processing step applies.
 *
 * It also pins the rules fingerprint, so a suite that "passed" against edited rules
 * would fail loudly instead of quietly proving something else.
 *
 * It shares the SAME emulator ports as the Stage 3, Stage 5B, Stage 6, Stage 9,
 * Stage 10, Stage 11 and Stage 12 runners, so the eight must be run one at a time: a
 * second `emulators:exec` cannot bind 8080/9099, and the resulting failure looks like
 * a broken repository rather than a port collision.
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
  settingsRulesTestFile,
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(settingsRulesTestFile)) {
  console.error(`[lab] the compiled Stage 13 test is missing: ${settingsRulesTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

const testCommand = `node --test "${settingsRulesTestFile}"`;

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
  console.log(`[lab] Stage 13 settings test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});