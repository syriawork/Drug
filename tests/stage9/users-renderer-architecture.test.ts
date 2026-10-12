/**
 * Stage 9 - architecture guards for the users module.
 *
 * Stage 8 already proves the renderer reaches no backend and no token. These
 * assertions EXTEND that guarantee to the code Stage 9 added: a users screen is
 * where a write path is most likely to grow a shortcut, so the boundary is
 * re-checked against the new source rather than assumed to still hold.
 *
 * The recurring claim is that the renderer cannot WRITE anything it did not
 * already have an operation for. A users screen tempts three specific
 * improvisations - a generic update, a raw status string, and a role field -
 * and each is asserted absent from the source.
 *
 * Comments are stripped before every scan, so a guard reads CODE rather than
 * prose and cannot be defeated (or broken) by a helpful explanation.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = join(__dirname, '..', '..', '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

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

/** The CODE of a project file, with code and HTML comments removed. */
function readCode(relativePath: string): string {
  return stripComments(readProjectFile(relativePath))
    .replace(/<!--[\s\S]*?-->/g, '')
    .toLowerCase();
}

const RENDERER_FILES: readonly string[] = [
  join('src', 'renderer', 'renderer.ts'),
  join('src', 'renderer', 'index.html'),
  join('src', 'renderer', 'styles.css'),
];

describe('Stage 9 requirement 21: the renderer reaches no backend', () => {
  it('contains no backend or transport vocabulary', () => {
    const forbidden: readonly string[] = [
      'firebase', 'firestore', 'googleapis', 'identitytoolkit', 'securetoken',
      'runquery', 'batchget', 'commitwrites', 'begintransaction',
      'stringvalue', 'integervalue', 'mapvalue', 'arrayvalue', 'timestampvalue',
      'updatemask', 'settoservervalue', 'relativepath', 'structuredquery',
    ];

    for (const relativePath of RENDERER_FILES) {
      const code = readCode(relativePath);
      for (const token of forbidden) {
        assert.equal(code.includes(token), false, `"${token}" found in ${relativePath}`);
      }
    }
  });
});

describe('Stage 9 requirement 22: the renderer reaches no token', () => {
  it('contains no token vocabulary', () => {
    const forbidden: readonly string[] = [
      'idtoken', 'refreshtoken', 'accesstoken', 'bearertoken',
      'serviceaccount', 'privatekey', 'credential',
    ];

    for (const relativePath of RENDERER_FILES) {
      const code = readCode(relativePath);
      for (const token of forbidden) {
        assert.equal(code.includes(token), false, `"${token}" found in ${relativePath}`);
      }
    }
  });

  it('keeps a bundle with no module syntax and no runtime require', () => {
    const bundle = readProjectFile(join('dist', 'renderer', 'renderer.js')).toLowerCase();
    for (const forbidden of ['import ', 'require(', 'export ']) {
      assert.equal(bundle.includes(forbidden), false, `"${forbidden}" found in the compiled bundle`);
    }
  });
});

describe('Stage 9 requirement 23: the renderer reaches no Node, Electron or filesystem API', () => {
  it('contains no platform or storage API', () => {
    const forbidden: readonly string[] = [
      'require(', 'process.', 'module.exports',
      "from 'electron'", 'from "electron"', "require('electron",
      'ipcrenderer', 'webcontents', 'browserwindow',
      'localstorage', 'sessionstorage', 'indexeddb', 'document.cookie',
      '__dirname', '__filename', 'child_process',
    ];

    for (const relativePath of RENDERER_FILES) {
      const code = readCode(relativePath);
      for (const token of forbidden) {
        assert.equal(code.includes(token), false, `"${token}" found in ${relativePath}`);
      }
    }
  });
});
describe('Stage 9 requirement 24: no generic IPC invocation is exposed', () => {
  it('reaches the backend only through the named bridge, never by channel', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    assert.equal(code.includes('drugmanager'), true);
    assert.equal(code.includes('ipcrenderer'), false);
    // No channel string and no transport verb may appear in the renderer.
    assert.equal(code.includes('drug-manager:'), false);
    for (const verb of ['invoke(', 'send(', 'runquery', 'commitwrites']) {
      assert.equal(code.includes(verb), false, `the renderer must not use ${verb}`);
    }
  });

  it('builds the update payload from named transitions, never a document', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // The precise claim is not "the word role never appears" - the shell
    // legitimately DISPLAYS one - but that the renderer can never ASSIGN one.
    // The only way to construct a role field is to write one of its values, so
    // the absence of those literals is the guarantee.
    for (const value of [": 'admin'", ": 'assistant'", ": 'employee'"]) {
      assert.equal(code.includes(value), false, `the renderer must not construct a role field (${value})`);
    }
    assert.equal(code.includes('updatemaskpaths'), false);
    // The only write shapes present are the three named intents.
    for (const intent of ["'approve'", "'reject'", "'grant'", "'revoke'"]) {
      assert.equal(code.includes(intent), true, `the renderer must use the ${intent} intent`);
    }
  });

  it('reads the employee id but never writes one', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // `user.employeeId` is a legitimate READ. What must not exist is an
    // assignment, which is why the check looks for the key followed by a colon
    // and a space rather than the identifier alone.
    assert.equal(code.includes('user.employeeid'), true, 'the id must still be readable for display');
    assert.equal(/[,{]\s*employeeid\s*:/.test(code), false, 'the renderer must not construct an employeeId field');
  });
});

describe('Stage 9 requirement 25: RTL remains enforced', () => {
  it('declares Arabic and RTL on the document', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));
    assert.ok(html.includes('<html lang="ar" dir="rtl">'));
    assert.ok(/body\s*\{[^}]*direction:\s*rtl/.test(readProjectFile(join('src', 'renderer', 'styles.css'))));
  });

  it('keeps the users page in Arabic', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    for (const label of ['المستخدمون', 'الاسم', 'الرقم الوظيفي', 'الدور', 'الحالة', 'آخر طلب', 'بحث', 'تحديث']) {
      assert.ok(html.includes(label), `the users page must show the Arabic label: ${label}`);
    }
  });

  it('ships no remote asset and keeps the focus ring visible', () => {
    for (const relativePath of RENDERER_FILES) {
      const content = readProjectFile(relativePath).toLowerCase();
      assert.equal(content.includes('http://'), false, `a remote URL found in ${relativePath}`);
      assert.equal(content.includes('https://'), false, `a remote URL found in ${relativePath}`);
    }
    const css = readProjectFile(join('src', 'renderer', 'styles.css'));
    assert.ok(css.includes(':focus-visible'));
    assert.equal(/outline:\s*(none|0)\b/.test(css), false, 'the focus ring must stay visible');
  });
});

describe('Stage 9: the users page is accessible and complete', () => {
  it('labels the search field and scopes the table headers', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.ok(html.includes('for="users-search-input"'));
    assert.ok(html.includes('<caption'));
    const headers = [...html.matchAll(/<th[^>]*scope="col"/g)];
    assert.ok(headers.length >= 5, 'every visible column needs a scoped header');
  });

  it('marks the dialog for assistive technology and keeps its error announceable', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.ok(html.includes('<dialog'));
    assert.ok(html.includes('aria-labelledby='));
    assert.ok(html.includes('id="user-dialog-error"'));
    assert.ok(html.includes('role="alert"'));
  });

  it('exposes exactly ONE editable field in the users page', () => {
    // Everything else about a profile is rendered as text. A second input would
    // be a field the repository contract may not be able to write.
    const html = readProjectFile(join('src', 'renderer', 'index.html'));
    const dialog = /<dialog[\s\S]*?<\/dialog>/.exec(html)?.[0] ?? '';
    const inputs = [...dialog.matchAll(/<input\b[^>]*id="([^"]*)"/g)].map((match) => match[1]);

    assert.deepEqual(inputs, ['user-detail-name']);
  });

  it('labels the technical identifier columns rather than inventing an email', () => {
    // The `users` collection has no email field, so the table must say what it
    // really is. The scope is the TABLE: the login form legitimately asks for an
    // email address, and that is a different screen.
    const html = readProjectFile(join('src', 'renderer', 'index.html'));
    const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';

    assert.equal(table.length > 0, true, 'the users table must exist');
    assert.equal(table.includes('الرقم الوظيفي'), true);
    assert.equal(table.includes('البريد الإلكتروني'), false, 'the users table must not claim an email column');
  });
});