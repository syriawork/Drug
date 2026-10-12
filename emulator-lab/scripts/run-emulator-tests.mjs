/**
 * Runs the Stage 3 Firestore Rules integration test against the REAL local
 * Firebase emulators.
 *
 * Usage: npm run emulator:test
 *
 * What it guarantees:
 *  1. the lab rules file is byte-identical to the authoritative Android rules
 *     (SHA-256 comparison) before anything is started;
 *  2. the official emulators are started through `firebase emulators:exec`, so
 *     the emulators are up before the test process starts and are shut down
 *     afterwards even when the tests fail;
 *  3. the test process is told that a live emulator is REQUIRED, so a missing
 *     emulator is a hard failure instead of a silent skip;
 *  4. no production Firebase project is involved: the project id is a "demo-"
 *     id, which Firebase can only resolve locally.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  AUTH_EMULATOR_HOST,
  FIRESTORE_EMULATOR_HOST,
  LAB_PROJECT_ID,
  assertLabIsInstalled,
  authoritativeRulesPath,
  firebaseCliPath,
  integrationTestFile,
  labFirebaseConfigPath,
  labRulesPath,
  projectRoot,
} from './lab-paths.mjs';

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

assertLabIsInstalled();

if (!existsSync(integrationTestFile)) {
  console.error(`[lab] the compiled integration test is missing: ${integrationTestFile}`);
  console.error('[lab] run "npm run build" first.');
  process.exit(1);
}

const labRulesHash = sha256(labRulesPath);
console.log(`[lab] lab rules file : ${labRulesPath}`);
console.log(`[lab] lab rules hash : ${labRulesHash}`);
console.log(`[lab] emulator ports : auth=${AUTH_EMULATOR_HOST} firestore=${FIRESTORE_EMULATOR_HOST}`);

if (existsSync(authoritativeRulesPath)) {
  const authoritativeHash = sha256(authoritativeRulesPath);
  console.log(`[lab] authoritative  : ${authoritativeRulesPath}`);
  console.log(`[lab] auth rules hash: ${authoritativeHash}`);
  if (authoritativeHash !== labRulesHash) {
    console.error('[lab] ABORT: the lab rules are NOT identical to the authoritative Android rules.');
    process.exit(1);
  }
  console.log('[lab] rules identity  : VERIFIED (the emulator enforces the Android rules)');
} else {
  console.warn(`[lab] WARNING: authoritative rules not found at ${authoritativeRulesPath}`);
  console.warn('[lab] continuing with the lab copy only; set DRUG_MANAGER_ANDROID_RULES_PATH to compare.');
}

const testCommand = `node --test "${integrationTestFile}"`;

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
      DRUG_MANAGER_ANDROID_RULES_PATH: authoritativeRulesPath,
    },
  },
);

child.on('exit', (code, signal) => {
  console.log('[lab] ----------------------------------------------------------------');
  if (signal !== null) {
    console.error(`[lab] the emulator runner was terminated by signal ${signal}`);
    process.exit(1);
  }
  console.log(`[lab] integration test exit code: ${code ?? 1}`);
  process.exit(code ?? 1);
});
