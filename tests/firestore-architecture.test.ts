import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Stage 3 architecture guards.
 *
 * They encode the non-negotiable constraints of the Firestore REST stage so a
 * future change fails the build instead of silently shipping:
 *  - no Firebase Web/Admin SDK, no Google Cloud client library;
 *  - no service-account / privileged credential anywhere;
 *  - tokens never persisted and never exposed to the renderer;
 *  - client-side authorization is impossible (role-agnostic client code);
 *  - the emulator laboratory stays isolated from the application graph.
 */

const projectRoot = join(__dirname, '..', '..');
const electronDir = join(projectRoot, 'electron');
const labDir = join(projectRoot, 'emulator-lab');

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

function listTypeScriptFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(absolutePath));
    } else if (entry.name.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }
  return files;
}

/** Every application-side TypeScript file of the main process. */
const mainProcessFiles = listTypeScriptFiles(electronDir);

/** Source modules that implement the Firestore REST layer. */
const firestoreLayerFiles: readonly string[] = [
  'electron/services/firestore-rest.ts',
  'electron/services/firestore-codec.ts',
  'electron/config/firestore-config.ts',
];

interface PackageJsonShape {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly scripts: Record<string, string>;
}

const appPackageJson = JSON.parse(readProjectFile('package.json')) as PackageJsonShape;

describe('stage 3 dependency policy', () => {
  it('ships without any Firebase/Google Cloud SDK or privileged credential', () => {
    const declared = [
      ...Object.keys(appPackageJson.dependencies ?? {}),
      ...Object.keys(appPackageJson.devDependencies),
    ];

    for (const dependency of declared) {
      const name = dependency.toLowerCase();
      for (const forbidden of ['firebase', 'firestore', 'google-cloud', 'google-auth', 'googleapis', 'grpc']) {
        assert.equal(name.includes(forbidden), false, `forbidden dependency declared: ${dependency}`);
      }
    }

    assert.deepEqual(Object.keys(appPackageJson.devDependencies).sort(), ['@types/node', 'electron', 'typescript']);
  });

  it('never imports a Firebase/Admin/Google Cloud client library in the main process', () => {
    const forbiddenImports: readonly string[] = [
      "from 'firebase",
      'from "firebase',
      "require('firebase",
      "from '@google-cloud",
      "from 'google-cloud",
      "require('@google-cloud",
      "from 'googleapis",
    ];

    for (const file of mainProcessFiles) {
      const content = readFileSync(file, 'utf8');
      for (const forbidden of forbiddenImports) {
        assert.equal(content.includes(forbidden), false, `forbidden import "${forbidden}" found in ${file}`);
      }
    }
  });

  it('contains no service-account credential file', () => {
    const suspiciousFiles = readdirSync(projectRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /service[-_]?account|credential|admin-sdk/i.test(name));

    assert.deepEqual(suspiciousFiles, [], 'no credential file may exist in the desktop project');
    assert.equal(existsSync(join(projectRoot, 'serviceAccount.json')), false);
    assert.equal(existsSync(join(projectRoot, 'service-account.json')), false);
  });
});

describe('stage 3 token policy', () => {
  it('never persists a token to disk or to web storage', () => {
    const forbiddenTokens: readonly string[] = [
      'writeFile',
      'appendFile',
      'localStorage',
      'sessionStorage',
      'electron-store',
      'keytar',
      'safeStorage',
    ];

    for (const file of mainProcessFiles) {
      const content = readFileSync(file, 'utf8');
      for (const forbidden of forbiddenTokens) {
        assert.equal(content.includes(forbidden), false, `"${forbidden}" found in ${file}`);
      }
    }
  });

  it('keeps the renderer-facing contract completely token-free', () => {
    const rendererFacingFiles: readonly string[] = [
      'electron/preload.ts',
      'electron/ipc/api.ts',
      'electron/ipc/channels.ts',
      'src/shared/ipc-contract.d.ts',
      'src/renderer/renderer.ts',
      'src/renderer/index.html',
    ];

    for (const relativePath of rendererFacingFiles) {
      const content = readProjectFile(relativePath).toLowerCase();
      for (const forbidden of ['idtoken', 'refreshtoken', 'accesstoken', 'serviceaccount']) {
        assert.equal(content.includes(forbidden), false, `"${forbidden}" found in ${relativePath}`);
      }
    }
  });

  it('keeps Firestore access out of the renderer bundle', () => {
    const compiledRenderer = readProjectFile(join('dist', 'renderer', 'renderer.js')).toLowerCase();
    for (const forbidden of ['firestore', 'firebase', 'googleapis', 'runquery', 'batchget']) {
      assert.equal(compiledRenderer.includes(forbidden), false, `"${forbidden}" found in the renderer bundle`);
    }
  });
});

describe('stage 3 authorization boundary', () => {
  it('keeps the REST client role-agnostic (no client-side authorization possible)', () => {
    const forbiddenLiterals: readonly string[] = [
      'isAdmin',
      'isApproved',
      'isOwner',
      'request.auth',
      'hasException',
      "'admin'",
      '"admin"',
      "'assistant'",
      '"assistant"',
      "'employee'",
      '"employee"',
      "'approved'",
      '"approved"',
      "'rejected'",
      '"rejected"',
    ];

    for (const relativePath of firestoreLayerFiles) {
      const content = readProjectFile(relativePath);
      for (const forbidden of forbiddenLiterals) {
        assert.equal(
          content.includes(forbidden),
          false,
          `the Firestore layer must not evaluate roles itself: "${forbidden}" found in ${relativePath}`,
        );
      }
    }
  });

  it('wires the Firestore client to the Stage 2 ID token provider inside the main process', () => {
    const mainSource = readProjectFile(join('electron', 'main.ts'));

    assert.ok(mainSource.includes('new FirestoreRestClient('), 'main.ts must own the Firestore REST client');
    assert.ok(
      mainSource.includes('getAccessToken: () => authService.getValidIdToken()'),
      'the client must obtain its token from the authentication layer',
    );
    assert.equal(mainSource.includes('loadURL('), false, 'no remote content may be loaded');
    assert.ok(
      mainSource.includes('Security Rules'),
      'main.ts must document that Firestore Security Rules are the authorization boundary',
    );
  });
});

describe('stage 3 emulator laboratory isolation', () => {
  it('keeps the isolated tool installation out of the application dependency graph', () => {
    const appPackageSource = readProjectFile('package.json');
    assert.equal(appPackageSource.includes('firebase-tools'), false, 'the app package must not depend on firebase-tools');

    const labToolsPackage = JSON.parse(
      readProjectFile(join('emulator-lab', 'tools', 'package.json')),
    ) as { devDependencies?: Record<string, string> };

    assert.ok(labToolsPackage.devDependencies?.['firebase-tools'], 'the lab must pin firebase-tools locally');
  });

  it('configures only the Auth and Firestore emulators with the lab rules file', () => {
    const labConfig = JSON.parse(readProjectFile(join('emulator-lab', 'firebase.json'))) as {
      firestore?: { rules?: string };
      emulators?: Record<string, unknown>;
    };

    assert.equal(labConfig.firestore?.rules, 'firestore.rules');
    assert.deepEqual(
      Object.keys(labConfig.emulators ?? {}).sort(),
      ['auth', 'firestore', 'singleProjectMode', 'ui'].sort(),
    );
    assert.equal(existsSync(join(labDir, 'firestore.rules')), true, 'the lab rules copy must exist');
    assert.equal(existsSync(join(labDir, 'scripts', 'run-emulator-tests.mjs')), true);
    assert.equal(existsSync(join(labDir, 'scripts', 'start.mjs')), true);
  });
});

describe('stage 3 documentation', () => {
  it('documents the Firestore REST architecture', () => {
    const documentation = readProjectFile(join('docs', 'firestore-rest-architecture.md'));

    for (const requiredTopic of [
      'Firestore REST',
      'Security Rules',
      'Google.Cloud.Firestore',
      'ID token',
      'request.auth.uid',
      'emulator',
      'Admin SDK',
    ]) {
      assert.ok(documentation.includes(requiredTopic), `the documentation must explain: ${requiredTopic}`);
    }
  });
});

