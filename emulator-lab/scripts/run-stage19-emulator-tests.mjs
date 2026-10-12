/**
 * Runs the Stage 19 selected-order movement detail suite against local emulators.
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
  orderStockMovementsRulesTestFile,
  projectRoot,
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(orderStockMovementsRulesTestFile)) {
  console.error(`[lab] the compiled Stage 19 test is missing: ${orderStockMovementsRulesTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

const testCommand = `node --test "${orderStockMovementsRulesTestFile}"`;
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
  console.log(`[lab] Stage 19 order movement test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});
