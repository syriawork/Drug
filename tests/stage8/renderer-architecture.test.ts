/**
 * Stage 8 - architecture guards for the renderer shell.
 *
 * These are SOURCE assertions, and they exist precisely because the behavioural
 * suite in `login-flow.test.ts` cannot see everything. A test that runs the
 * bundle proves what the code does; a test that reads the file proves what the
 * code could never be changed to do without failing the build.
 *
 * Comments are stripped before every scan. Without that, a perfectly good
 * explanatory comment that happens to mention a forbidden word would fail the
 * build - which trains people to work around the guard instead of reading it.
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = join(__dirname, '..', '..', '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

/** Strips comments so a guard reads CODE, not prose. */
function stripComments(source: string): string {
  let output = '';
  let index = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let quote = '';

  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        output += character;
      }
      index += 1;
      continue;
    }
    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 2;
        continue;
      }
      if (character === '\n') {
        output += character;
      }
      index += 1;
      continue;
    }
    if (quote !== '') {
      output += character;
      if (character === '\\') {
        output += next;
        index += 2;
        continue;
      }
      if (character === quote) {
        quote = '';
      }
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    }
    output += character;
    index += 1;
  }

  return output;
}

const RENDERER_FILES: readonly string[] = [
  join('src', 'renderer', 'renderer.ts'),
  join('src', 'renderer', 'index.html'),
  join('src', 'renderer', 'styles.css'),
];

describe('Stage 8 requirement 2 & 3: the renderer reaches no backend and no token', () => {
  it('contains no backend or transport vocabulary', () => {
    const forbidden: readonly string[] = [
      'firebase', 'firestore', 'googleapis', 'identitytoolkit', 'securetoken',
      'runquery', 'batchget', 'commitwrites', 'begintransaction',
      'stringvalue', 'integervalue', 'mapvalue', 'arrayvalue', 'timestampvalue',
      'updatemask', 'settoservervalue', 'relativepath', 'structuredquery',
    ];

    for (const relativePath of RENDERER_FILES) {
      const code = stripComments(readProjectFile(relativePath)).toLowerCase();
      for (const token of forbidden) {
        assert.equal(code.includes(token), false, `"${token}" found in ${relativePath}`);
      }
    }
  });

  it('contains no token vocabulary', () => {
    const forbidden: readonly string[] = [
      'idtoken', 'refreshtoken', 'accesstoken', 'bearertoken',
      'serviceaccount', 'privatekey', 'credential',
    ];

    for (const relativePath of RENDERER_FILES) {
      const code = stripComments(readProjectFile(relativePath)).toLowerCase();
      for (const token of forbidden) {
        assert.equal(code.includes(token), false, `"${token}" found in ${relativePath}`);
      }
    }
  });

  it('reaches no Node.js, Electron or storage API', () => {
    // These are API ACCESS patterns, not product names. The status card
    // legitimately renders the string "Electron" as an Arabic label, so a bare
    // word match would fail on something that is not an Electron API call.
    const forbidden: readonly string[] = [
      'require(', 'process.', 'module.exports',
      "from 'electron'", 'from "electron"', "require('electron",
      'ipcrenderer', 'webcontents', 'browserwindow',
      'localstorage', 'sessionstorage', 'indexeddb', 'document.cookie',
      '__dirname', '__filename', 'child_process',
    ];

    for (const relativePath of RENDERER_FILES) {
      // HTML comments are prose too, so they are stripped alongside code comments.
      const code = stripComments(readProjectFile(relativePath))
        .replace(/<!--[\s\S]*?-->/g, '')
        .toLowerCase();
      for (const token of forbidden) {
        assert.equal(code.includes(token), false, `"${token}" found in ${relativePath}`);
      }
    }
  });

  it('emits a bundle with no module syntax and no runtime require', () => {
    const bundle = readProjectFile(join('dist', 'renderer', 'renderer.js')).toLowerCase();
    for (const forbidden of ['import ', 'require(', 'export ']) {
      assert.equal(bundle.includes(forbidden), false, `"${forbidden}" found in the compiled bundle`);
    }
  });

  it('reaches the Main process only through the named bridge', () => {
    const code = stripComments(readProjectFile(join('src', 'renderer', 'renderer.ts'))).toLowerCase();

    // The bridge global, and nothing else that could reach the Main process.
    assert.equal(code.includes('drugmanager'), true);
    assert.equal(code.includes('ipcrenderer'), false);
    // No channel string may appear: the renderer names operations, never channels.
    assert.equal(code.includes('drug-manager:'), false);
  });
});

describe('Stage 8 requirement 11: the shell is right-to-left and Arabic', () => {
  it('declares Arabic and RTL on the document', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.ok(html.includes('<html lang="ar" dir="rtl">'));
  });

  it('pins the Latin credential fields to LTR inside an RTL form', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    // An email address is Latin text; leaving it in an RTL paragraph puts the
    // caret on the wrong side and reorders the punctuation.
    assert.ok(/id="login-email"[\s\S]{0,200}dir="ltr"/.test(html));
    assert.ok(/id="login-password"[\s\S]{0,200}dir="ltr"/.test(html));
  });

  it('gives the document a right-to-left base direction in CSS too', () => {
    const css = readProjectFile(join('src', 'renderer', 'styles.css'));
    assert.ok(/body\s*\{[^}]*direction:\s*rtl/.test(css));
  });

  it('uses Arabic for every user-visible shell label', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    for (const label of [
      'مدير نظام الطلبات والمخزون',
      'تسجيل الدخول',
      'تسجيل الخروج',
      'البريد الإلكتروني',
      'كلمة المرور',
      'لوحة التحكم',
      'المستخدمون',
      'الأدوية',
      'طلبات الأدوية',
      'المخزون',
      'الإعدادات',
    ]) {
      assert.ok(html.includes(label), `the shell must show the Arabic label: ${label}`);
    }
  });

  it('marks no navigation entry as coming in a later stage', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    // Stage 14 implemented the LAST placeholder (`stock`), so every entry the
    // shell offers is now a working screen.
    //
    // The count is asserted rather than assumed: a "coming soon" tag reappearing
    // means some screen regressed to a placeholder, and this is where it would be
    // caught. The navigation array must stay in step with the markup, so the two
    // halves of the claim are checked together below.
    const tags = [...html.matchAll(/class="nav-item-tag">([^<]*)</g)].map((match) => match[1]);
    assert.deepEqual(tags, [], 'every navigation entry is implemented, so none may be tagged');

    // Every `data-view` the markup offers is marked implemented in the renderer.
    const declaredViews = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1] ?? '');
    const implementedInRenderer = [...readProjectFile(join('src', 'renderer', 'renderer.ts'))
      .matchAll(/\{ view: '([^']+)', label: '[^']*', implemented: true \}/g)]
      .map((match) => match[1] ?? '');

    assert.deepEqual(
      [...implementedInRenderer].sort(),
      [...declaredViews].sort(),
      'every shipped navigation entry must be implemented, and no more',
    );
  });
});
describe('Stage 8: the login form is accessible and complete', () => {
  it('labels both credential inputs', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.ok(html.includes('for="login-email"'));
    assert.ok(html.includes('for="login-password"'));
    assert.ok(html.includes('type="email"'));
    assert.ok(html.includes('type="password"'));
  });

  it('uses semantic elements rather than a div soup', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    for (const tag of ['<form', '<label', '<nav', '<main', '<header', '<footer', '<button', '<dl']) {
      assert.ok(html.includes(tag), `the shell must use the semantic element ${tag}`);
    }
  });

  it('announces the error region and the toggle to assistive technology', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.ok(html.includes('role="alert"'));
    assert.ok(html.includes('aria-live='));
    assert.ok(html.includes('aria-pressed='));
    assert.ok(html.includes('aria-controls='));
    assert.ok(html.includes('aria-current='));
  });

  it('marks the shell state so it is observable without the script', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    // The five-state model lives on `<body>`; CSS keys off it and tests read it.
    assert.ok(html.includes('data-ui-state="initializing"'));
  });

  it('does not ship any remote asset or external font', () => {
    for (const relativePath of RENDERER_FILES) {
      const content = readProjectFile(relativePath).toLowerCase();
      assert.equal(content.includes('http://'), false, `a remote URL found in ${relativePath}`);
      assert.equal(content.includes('https://'), false, `a remote URL found in ${relativePath}`);
      assert.equal(content.includes('@import'), false, `a CSS import found in ${relativePath}`);
    }
  });

  it('keeps a visible keyboard focus ring', () => {
    const css = readProjectFile(join('src', 'renderer', 'styles.css'));
    // The focus style must exist AND must not be neutralised to `none`.
    assert.ok(css.includes(':focus-visible'));
    assert.equal(/outline:\s*(none|0)\b/.test(css), false, 'the focus ring must stay visible');
  });

  it('defines the design tokens as CSS variables', () => {
    const css = readProjectFile(join('src', 'renderer', 'styles.css'));
    const tokenBlock = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';

    assert.ok(tokenBlock.length > 0, 'the palette must live in a :root token block');
    for (const token of ['--color-', '--space-', '--radius-', '--font-']) {
      assert.ok(tokenBlock.includes(token), `the token block must define ${token}`);
    }
  });
});
