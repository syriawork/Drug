/**
 * Starts the isolated local emulators (Auth + Firestore) in the foreground.
 *
 * Usage: npm run emulator:start
 *
 * The emulator loads emulator-lab/firestore.rules, which is a byte-for-byte copy
 * of the authoritative rules of the Android project. The productions rules file
 * is never touched.
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
} from './lab-paths.mjs';

assertLabIsInstalled();

if (!existsSync(labFirebaseConfigPath)) {
  throw new Error(`missing lab configuration: ${labFirebaseConfigPath}`);
}

console.log('[lab] starting emulators (isolated laboratory)');
console.log(`[lab] project id          : ${LAB_PROJECT_ID}`);
console.log(`[lab] auth emulator       : http://${AUTH_EMULATOR_HOST}`);
console.log(`[lab] firestore emulator  : http://${FIRESTORE_EMULATOR_HOST}`);
console.log(`[lab] rules               : ${labFirebaseConfigPath} -> firestore.rules`);
console.log('[lab] press Ctrl+C to stop');

const child = spawn(
  process.execPath,
  [
    firebaseCliPath,
    'emulators:start',
    '--config',
    labFirebaseConfigPath,
    '--project',
    LAB_PROJECT_ID,
    '--only',
    'auth,firestore',
  ],
  { stdio: 'inherit', cwd: labFirebaseConfigPath.replace(/[\\/]firebase\.json$/, '') },
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
