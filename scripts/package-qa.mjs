import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const qaFlagsSource = resolve(root, 'electron/config/build-flags.qa.ts');
const qaFlagsOutput = resolve(root, 'dist/electron/config/build-flags.qa.js');
const packagedFlagsOutput = resolve(root, 'dist/electron/config/build-flags.js');
const npmCli = process.env['npm_execpath'];
const require = createRequire(import.meta.url);

function runNode(script, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${script} exited with status ${String(result.status)}`);
  }
}

function runNpm(args) {
  if (!npmCli) {
    throw new Error('package:qa must be run through npm so the project npm CLI is available');
  }
  runNode(npmCli, args);
}

function runTypeScript(project) {
  runNode(resolve(root, 'node_modules/typescript/bin/tsc'), ['-p', project]);
}

if (existsSync(qaFlagsSource)) {
  throw new Error(`${qaFlagsSource} already exists; refusing to overwrite an existing file`);
}

try {
  runNpm(['run', 'clean']);
  runNode(
    resolve(root, 'scripts/generate-qa-build-flags.mjs'),
    [],
    { ...process.env, DRUG_MANAGER_QA_BUILD: '1' },
  );
  runTypeScript('tsconfig.qa.json');
  runTypeScript('tsconfig.renderer.json');
  runNode(resolve(root, 'scripts/copy-static.mjs'));

  if (!existsSync(qaFlagsOutput)) {
    throw new Error('QA TypeScript compilation did not emit the QA capability module');
  }
  copyFileSync(qaFlagsOutput, packagedFlagsOutput);
  unlinkSync(qaFlagsOutput);
  unlinkSync(qaFlagsSource);

  const { ALLOW_FIREBASE_EMULATORS } = require(packagedFlagsOutput);
  if (ALLOW_FIREBASE_EMULATORS !== true) {
    throw new Error('Packaged QA build does not contain the emulator capability');
  }

  const builderCli = resolve(root, 'node_modules/electron-builder/cli.js');
  if (!existsSync(builderCli)) {
    throw new Error('electron-builder CLI is unavailable; install the declared project dependencies');
  }
  const packageEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  for (const name of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'CSC_NAME',
    'WIN_CSC_LINK',
    'WIN_CSC_KEY_PASSWORD',
    'WIN_CSC_NAME',
  ]) {
    delete packageEnv[name];
  }
  runNode(builderCli, [
    '--config',
    'electron-builder.qa.json',
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
  ], packageEnv);
} finally {
  if (existsSync(qaFlagsSource)) {
    unlinkSync(qaFlagsSource);
  }
  if (existsSync(qaFlagsOutput)) {
    unlinkSync(qaFlagsOutput);
  }
}
