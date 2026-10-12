import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Architecture guard tests.
 *
 * They encode the project constraints so that a future change - adding a
 * Firebase SDK, a UI framework, a remote URL or a service-account package -
 * fails the test-suite instead of silently shipping.
 *
 * Everything here reads local project files: no network, no production Firebase, no
 * Electron runtime and no file outside this project.
 */
const projectRoot = join(__dirname, '..', '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

interface PackageJsonShape {
  readonly name: string;
  readonly main: string;
  readonly scripts: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies: Record<string, string>;
}

const packageJson = JSON.parse(readProjectFile('package.json')) as PackageJsonShape;

const ALLOWED_DEV_DEPENDENCIES: readonly string[] = ['@types/node', 'electron', 'typescript'];

const FORBIDDEN_DEPENDENCY_FRAGMENTS: readonly string[] = [
  'firebase',
  'firestore',
  'google-cloud',
  'googleapis',
  'google-auth',
  'react',
  'vue',
  'angular',
  'svelte',
  'bootstrap',
  'tailwind',
  'jquery',
  '@electron/remote',
  'electron-store',
];

describe('dependency policy', () => {
  it('ships with no runtime dependency at all (pure built-in REST)', () => {
    assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), []);
  });

  it('uses only the minimum development dependencies', () => {
    assert.deepEqual(Object.keys(packageJson.devDependencies).sort(), [...ALLOWED_DEV_DEPENDENCIES].sort());
  });

  it('contains no Firebase SDK, Google Cloud or UI framework dependency', () => {
    const declaredDependencies = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies),
    ];

    for (const dependency of declaredDependencies) {
      const lowerCasedName = dependency.toLowerCase();
      for (const forbiddenFragment of FORBIDDEN_DEPENDENCY_FRAGMENTS) {
        assert.equal(
          lowerCasedName.includes(forbiddenFragment),
          false,
          `forbidden dependency declared: ${dependency}`,
        );
      }
    }
  });
});

describe('npm scripts and entry point', () => {
  it('declares the required scripts', () => {
    for (const scriptName of ['development', 'build', 'typecheck', 'test']) {
      assert.equal(typeof packageJson.scripts[scriptName], 'string', `missing npm script: ${scriptName}`);
    }
  });

  it('points the Electron entry point at the compiled main process', () => {
    assert.equal(packageJson.main, 'dist/electron/main.js');
  });
});

describe('renderer constraints', () => {
  it('declares Arabic RTL and a strict content security policy', () => {
    const indexHtml = readProjectFile('src/renderer/index.html');

    assert.ok(indexHtml.includes('lang="ar"'));
    assert.ok(indexHtml.includes('dir="rtl"'));
    assert.ok(indexHtml.includes("default-src 'none'"));
    assert.ok(indexHtml.includes("script-src 'self'"));
    assert.ok(indexHtml.includes("connect-src 'none'"));
  });

  it('never references a remote URL in renderer source', () => {
    const localRendererFiles: readonly string[] = [
      'src/renderer/index.html',
      'src/renderer/renderer.ts',
      'src/renderer/styles.css',
    ];

    for (const relativePath of localRendererFiles) {
      const content = readProjectFile(relativePath).toLowerCase();
      assert.equal(content.includes('http://'), false, `remote URL found in ${relativePath}`);
      assert.equal(content.includes('https://'), false, `remote URL found in ${relativePath}`);
    }
  });

  it('contains the required Arabic title and status anchors', () => {
    const indexHtml = readProjectFile('src/renderer/index.html');

    assert.ok(indexHtml.includes('مدير نظام الطلبات والمخزون'));

    for (const elementId of ['app-title', 'status-card', 'status-value', 'info-list']) {
      assert.ok(indexHtml.includes(`id="${elementId}"`), `missing element id: ${elementId}`);
    }

    assert.ok(indexHtml.includes('src="renderer.js"'));
  });

  it('keeps the compiled renderer bundle free of Firebase and Node.js access', () => {
    assert.ok(
      existsSync(join(projectRoot, 'dist', 'renderer', 'renderer.js')),
      'the renderer bundle is missing: run npm run build before npm test',
    );

    const compiledRenderer = readProjectFile('dist/renderer/renderer.js').toLowerCase();

    for (const forbiddenToken of ['firebase', 'firestore', 'googleapis', 'require(', 'import ']) {
      assert.equal(
        compiledRenderer.includes(forbiddenToken),
        false,
        `forbidden token found in the renderer bundle: ${forbiddenToken}`,
      );
    }
  });

  it('ships the markup and the stylesheet next to the compiled script', () => {
    assert.ok(existsSync(join(projectRoot, 'dist', 'renderer', 'index.html')));
    assert.ok(existsSync(join(projectRoot, 'dist', 'renderer', 'styles.css')));
    assert.ok(existsSync(join(projectRoot, 'dist', 'renderer', 'renderer.js')));
  });
});

describe('main process & security constraints', () => {
  it('loads only local content into BrowserWindow', () => {
    for (const relativePath of ['electron/main.ts', 'electron/preload.ts']) {
      const content = readProjectFile(relativePath);

      assert.equal(content.includes('loadURL('), false, `loadURL() is not allowed in ${relativePath}`);
      assert.equal(content.includes("from 'firebase"), false, `Firebase SDK import found in ${relativePath}`);
    }
  });

  it('exposes a single minimal bridge and never exposes node or tokens', () => {
    const preloadSource = readProjectFile('electron/preload.ts');

    assert.equal(preloadSource.split('exposeInMainWorld').length - 1, 1);
    assert.ok(preloadSource.includes("exposeInMainWorld('drugManager'"));
    assert.equal(preloadSource.includes("from 'node:"), false);
    assert.equal(preloadSource.includes('child_process'), false);
    assert.equal(preloadSource.includes('shell'), false);
    // Refresh token must NEVER appear in preload
    assert.equal(preloadSource.includes('refreshToken'), false);
  });

  it('stays completely independent from the Android project', () => {
    const projectFiles: readonly string[] = [
      'package.json',
      'electron/main.ts',
      'electron/preload.ts',
      'src/renderer/renderer.ts',
      'src/renderer/index.html',
    ];

    for (const relativePath of projectFiles) {
      const content = readProjectFile(relativePath).toLowerCase();

      for (const androidToken of ['myfirstapp', 'android', 'com.example']) {
        assert.equal(
          content.includes(androidToken),
          false,
          `Android token "${androidToken}" found in ${relativePath}`,
        );
      }
    }
  });
});