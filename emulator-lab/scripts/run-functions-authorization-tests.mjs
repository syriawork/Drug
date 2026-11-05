import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  AUTH_EMULATOR_HOST,
  EVENTARC_EMULATOR_HOST,
  FIRESTORE_EMULATOR_HOST,
  FUNCTIONS_EMULATOR_HOST,
  LAB_PROJECT_ID,
  TASKS_EMULATOR_HOST,
  assertLabIsInstalled,
  firebaseCliPath,
  labFirebaseConfigPath,
  labRoot,
  projectRoot,
} from './lab-paths.mjs';

const functionsRoot = join(projectRoot, 'functions');
const typeScriptCli = join(functionsRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const authorizationTest = join(functionsRoot, 'test', 'authorization-emulator.test.cjs');
const submitOrderTest = join(functionsRoot, 'test', 'submit-order-emulator.test.cjs');

assertLabIsInstalled();
if (!existsSync(typeScriptCli) || !existsSync(authorizationTest) || !existsSync(submitOrderTest)) {
  console.error('[stage34c] Functions dependencies or emulator tests are missing.');
  console.error('[stage34c] Run npm ci from functions/ before the emulator test.');
  process.exit(1);
}

const build = spawnSync(process.execPath, [typeScriptCli, '-p', join(functionsRoot, 'tsconfig.json')], {
  cwd: functionsRoot,
  stdio: 'inherit',
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const testCommand = `node --test "${authorizationTest}" "${submitOrderTest}"`;
console.log(`[stage34c] project id          : ${LAB_PROJECT_ID}`);
console.log(`[stage34c] auth emulator       : http://${AUTH_EMULATOR_HOST}`);
console.log(`[stage34c] firestore emulator  : http://${FIRESTORE_EMULATOR_HOST}`);
console.log(`[stage34c] functions emulator : http://${FUNCTIONS_EMULATOR_HOST}`);
console.log(`[stage34c] Eventarc helper    : http://${EVENTARC_EMULATOR_HOST}`);
console.log(`[stage34c] Cloud Tasks helper : http://${TASKS_EMULATOR_HOST}`);
console.log('[stage34c] starting only auth, firestore, and functions; emulators:exec shuts down only this run');

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
    'auth,firestore,functions',
    testCommand,
  ],
  {
    stdio: 'inherit',
    cwd: labRoot,
    env: {
      ...process.env,
      FIREBASE_PROJECT_ID: LAB_PROJECT_ID,
      LAB_PROJECT_ID,
      FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
      FIRESTORE_EMULATOR_HOST,
      FUNCTIONS_EMULATOR_HOST,
      CLOUD_EVENTARC_EMULATOR_HOST: `http://${EVENTARC_EMULATOR_HOST}`,
      CLOUD_TASKS_EMULATOR_HOST: `http://${TASKS_EMULATOR_HOST}`,
      FUNCTIONS_DISCOVERY_TIMEOUT: '60',
      METADATA_SERVER_DETECTION: 'none',
    },
  },
);

child.on('error', (error) => {
  console.error(`[stage34c] could not start the local emulator runner: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`[stage34c] emulator runner stopped by signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[stage34c] emulator authorization test exit code: ${code ?? 1}`);
  process.exitCode = code ?? 1;
});
