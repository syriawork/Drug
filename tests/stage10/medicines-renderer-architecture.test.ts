/**
 * Stage 10 - architecture guards for the medicines module.
 *
 * Stages 8 and 9 already prove the renderer reaches no backend and no token.
 * These assertions EXTEND that guarantee to the code Stage 10 added, and they
 * carry extra weight for medicines specifically: this is the first stage where
 * the UI is allowed to CHANGE a domain value, so the guard's job is to prove the
 * renderer still cannot reach anything beyond the one field.
 *
 * The recurring claim is that the renderer cannot write inventory. Three
 * specific improvisations are asserted absent: a stock key, a counter key, and
 * any attempt to compute a figure from another.
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

/** Every test below scans the renderer for this vocabulary. */
const BACKEND_VOCABULARY: readonly string[] = [
  'firebase', 'firestore', 'googleapis', 'identitytoolkit', 'securetoken',
  'runquery', 'batchget', 'commitwrites', 'begintransaction',
  'stringvalue', 'integervalue', 'mapvalue', 'arrayvalue', 'timestampvalue',
  'updatemask', 'settoservervalue', 'relativepath', 'structuredquery',
];

const TOKEN_VOCABULARY: readonly string[] = [
  'idtoken', 'refreshtoken', 'accesstoken', 'bearertoken',
  'serviceaccount', 'privatekey', 'credential',
];

const PLATFORM_VOCABULARY: readonly string[] = [
  'require(', 'process.', 'module.exports',
  "from 'electron'", 'from "electron"', "require('electron",
  'ipcrenderer', 'webcontents', 'browserwindow',
  'localstorage', 'sessionstorage', 'indexeddb', 'document.cookie',
  '__dirname', '__filename', 'child_process',
];

/** Asserts that no renderer file contains any of the given vocabulary. */
function assertNoVocabulary(vocabulary: readonly string[], label: string): void {
  for (const relativePath of RENDERER_FILES) {
    const code = readCode(relativePath);
    for (const token of vocabulary) {
      assert.equal(code.includes(token), false, `"${token}" (${label}) found in ${relativePath}`);
    }
  }
}
describe('Stage 10 requirement 22: the renderer reaches no backend', () => {
  it('contains no backend or transport vocabulary', () => {
    assertNoVocabulary(BACKEND_VOCABULARY, 'backend');
  });
});

describe('Stage 10 requirement 23: the renderer reaches no token', () => {
  it('contains no token vocabulary', () => {
    assertNoVocabulary(TOKEN_VOCABULARY, 'token');
  });

  it('keeps a bundle with no module syntax and no runtime require', () => {
    const bundle = readProjectFile(join('dist', 'renderer', 'renderer.js')).toLowerCase();
    for (const forbidden of ['import ', 'require(', 'export ']) {
      assert.equal(bundle.includes(forbidden), false, `"${forbidden}" found in the compiled bundle`);
    }
  });
});

describe('Stage 10 requirement 24: the renderer reaches no Node or Electron API', () => {
  it('contains no platform or storage API', () => {
    assertNoVocabulary(PLATFORM_VOCABULARY, 'platform');
  });
});

describe('Stage 10 requirement 25: no generic IPC invocation is exposed', () => {
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

  it('builds the update payload from one field, never a document', () => {
    // The strongest form of this guard reads the ACTUAL argument that is sent,
    // rather than banning keywords. A renderer could pass a whole document under
    // any key name; it cannot pass one without adding a key to this literal.
    const source = readProjectFile(join('src', 'renderer', 'renderer.ts'));
    const calls = [...source.matchAll(/updateMaxQuantity\(\{([\s\S]*?)\}\)/g)];

    assert.equal(calls.length, 1, 'the renderer must have exactly one update call site');
    const keys = [...(calls[0]?.[1] ?? '').matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)].map((match) => match[1]);

    // `{medicineId, maxQuantity}` and nothing else: no document, no mask, no
    // stock figure and no counter could travel this call.
    assert.deepEqual([...keys].sort(), ['maxQuantity', 'medicineId']);

    const code = readCode(join('src', 'renderer', 'renderer.ts'));
    assert.equal(code.includes('updatemaskpaths'), false);
    assert.equal(code.includes('totalinward:'), false);
    assert.equal(code.includes('totaloutward:'), false);
  });

  it('never derives an inventory figure from another field', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // The renderer READS each of the four figures and prints it. There must be no
    // arithmetic between them: `totalInward - totalOutward` is NOT the stock, and
    // a subtraction here would contradict the processor that owns the value.
    assert.equal(
      /totalinward\s*-\s*totaloutward/.test(code),
      false,
      'the renderer must not subtract the counters',
    );
    assert.equal(
      /totaloutward\s*-\s*totalinward/.test(code),
      false,
      'the renderer must not subtract the counters',
    );
  });
});

describe('Stage 10 requirement 26: RTL remains enforced', () => {
  it('declares Arabic and RTL on the document', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));
    assert.ok(html.includes('<html lang="ar" dir="rtl">'));
    assert.ok(/body\s*\{[^}]*direction:\s*rtl/.test(readProjectFile(join('src', 'renderer', 'styles.css'))));
  });

  it('keeps the medicines page in Arabic', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    for (const label of ['الأدوية', 'اسم الدواء', 'المخزون', 'الحد الأقصى', 'الوارد', 'المصروف', 'بحث', 'تحديث']) {
      assert.ok(html.includes(label), `the medicines page must show the Arabic label: ${label}`);
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

describe('Stage 10: the medicines page exposes only its named editable fields', () => {
  it('labels the search field and scopes the table headers', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.ok(html.includes('for="medicines-search-input"'), 'the search box needs a bound label');
    // The medicines table specifically, not merely the first table in the file.
    const table = /<table[^>]*>[\s\S]*?<\/table>/g;
    const medicinesTable = [...html.matchAll(table)]
      .map((match) => match[0])
      .find((candidate) => candidate.includes('id="medicines-rows"'));

    assert.ok(medicinesTable !== undefined, 'the catalogue table must exist');
    assert.ok((medicinesTable?.match(/scope="col"/g) ?? []).length >= 5, 'every catalogue column needs a scoped header');
  });

  it('exposes only the policy field and the named inbound quantity in the medicine dialog', () => {
    // The receipt quantity belongs only to the atomic named use case. A balance
    // or generic inventory field remains unreachable from this dialog.
    const html = readProjectFile(join('src', 'renderer', 'index.html'));
    const dialog = /<dialog class="user-dialog" id="medicine-dialog"[\s\S]*?<\/dialog>/.exec(html)?.[0] ?? '';
    const inputs = [...dialog.matchAll(/<input\b[^>]*id="([^"]*)"/g)].map((match) => match[1]);

    assert.deepEqual(inputs, [
      'medicine-detail-max-quantity',
      'medicine-detail-inbound-quantity',
    ]);
  });

  it('keeps the dialog announceable', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.ok(html.includes('id="medicine-dialog"'));
    assert.ok(html.includes('aria-labelledby='));
    assert.ok(html.includes('role="alert"'));
  });
});