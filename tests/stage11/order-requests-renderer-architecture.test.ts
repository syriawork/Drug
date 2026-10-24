/**
 * Stage 11 - architecture guards for the Order Requests module.
 *
 * The Stage 8/9/10 suites already prove the renderer reaches no backend and no
 * token. These assertions EXTEND that guarantee to the code Stage 11 added, and
 * they carry extra weight here for a specific reason: this is the first stage
 * where the UI is allowed to ASK the backend to change inventory. The guard's job
 * is therefore to prove that "change inventory" is reachable ONLY by naming a
 * request id, and that no second implementation of Stage 6 grew alongside it.
 *
 * TWO ARTIFACTS ARE SCANNED, not one:
 *
 *   1. the SOURCE under `src/renderer/`, which is what a reviewer reads, and
 *   2. the COMPILED BUNDLE `dist/renderer/renderer.js` that actually ships.
 *
 * Scanning only the source would leave a gap where a build step, a copied file
 * or an edit straight into `dist/` put code into the shipped artefact that no
 * source guard can see. The bundle is the real thing, so the real thing is read.
 *
 * Comments are stripped before every scan, so a guard reads CODE rather than
 * prose and cannot be defeated (or broken) by a helpful explanation.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = join(__dirname, '..', '..', '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

/** The shipped renderer bundle: the artifact a user's machine actually loads. */
const BUNDLE_PATH = join('dist', 'renderer', 'renderer.js');

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

/**
 * Every artifact that must be free of a forbidden token.
 *
 * The bundle is included deliberately and is checked for existence first, so a
 * missing build fails loudly here instead of silently skipping the strongest
 * guard in the file.
 */
function scannedArtifacts(): readonly string[] {
  assert.equal(
    existsSync(join(projectRoot, BUNDLE_PATH)),
    true,
    `the shipped bundle is missing: ${BUNDLE_PATH}. Run "npm run build" first.`,
  );
  return [...RENDERER_FILES, BUNDLE_PATH];
}

/** Every test below scans every renderer artifact for this vocabulary. */
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

/**
/**
 * Stage 11 specific: the vocabulary of the Stage 6 ENGINE.
 *
 * These are the words a SECOND implementation would need. Their absence is the
 * mechanical form of "the renderer orchestrates; Stage 6 decides".
 *
 * The stored FIELD names (`minDaysBetweenOrders`, `startTime`, ...) are not in
 * this list. Stage 13 exists to display them read-only, so banning the words
 * would forbid a page this project is meant to ship. Field access is checked
 * precisely instead - see `assertFieldsAreReadOnly` in the Stage 12 architecture
 * suite, which proves each field is only ever rendered.
 */
const ENGINE_VOCABULARY: readonly string[] = [
  'aggregatelines', 'createorder', 'createstocklog', 'st_logs',
  'updatemedicinestock', 'markrequestprocessed', 'markrequestfailed',
  'updateusersummary', 'damascusmonthyear', 'validateusereligibility',
];

/**
 * A collection path the renderer must never be able to ADDRESS for a write.
 *
 * Deliberately narrower than a field-name ban. `maxQuantity`, `totalInward` and
 * `totalOutward` all appear in the renderer legitimately: Stage 10 renders them
 * as read-only columns and offers exactly one masked write. Banning the words
 * would forbid displaying a value the manager must see.
 *
 * What must be impossible is ADDRESSING a collection - which is why these are
 * paths with a trailing slash, not field names.
 */
const WRITE_VOCABULARY: readonly string[] = [
  'stock_logs', 'medicines/', 'users/', 'orders/', 'settings/',
];

const PLATFORM_VOCABULARY: readonly string[] = [
  'require(', 'process.', 'module.exports',
  "from 'electron'", 'from "electron"', "require('electron",
  'ipcrenderer', 'webcontents', 'browserwindow',
  'localstorage', 'sessionstorage', 'indexeddb', 'document.cookie',
  '__dirname', '__filename', 'child_process',
];

/** Asserts that no renderer artifact contains any of the given vocabulary. */
function assertNoVocabulary(vocabulary: readonly string[], label: string): void {
  for (const relativePath of scannedArtifacts()) {
    const code = readCode(relativePath);
    for (const token of vocabulary) {
      assert.equal(code.includes(token), false, `"${token}" (${label}) found in ${relativePath}`);
    }
  }
}

describe('Stage 11 requirement 15: the document stays right-to-left Arabic', () => {
  it('keeps the RTL direction and the Arabic language on the shell', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.match(html, /<html[^>]*\blang="ar"/i, 'the document must declare Arabic');
    assert.match(html, /<html[^>]*\bdir="rtl"/i, 'the document must be right-to-left');
    // The charset lives on its own `<meta>`, not on the `<html>` element.
    assert.match(html, /<meta[^>]*charset="utf-8"/i, 'Arabic requires an explicit UTF-8');
  });

  it('marks the order-requests section up as a real Arabic region', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));
    const section = /<section[^>]*id="orders-view"[\s\S]*?<\/section>/i.exec(html);

    assert.notEqual(section, null, 'the shipped markup must contain the orders view');
    const markup = section?.[0] ?? '';
    // Arabic content is required: an English-only region would pass a structural
    // check while shipping a page the users cannot read.
    assert.match(markup, /[\u0600-\u06FF]/, 'the orders view must contain Arabic text');
    assert.match(markup, /id="orders-rows"/, 'the queue table body must exist');
    assert.match(markup, /id="orders-search-input"/, 'the search control must exist');
    assert.match(markup, /id="orders-status-filter"/, 'the status filter must exist');
  });

  it('labels the queue with a caption and scoped column headers', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));
    const section = /<section[^>]*id="orders-view"[\s\S]*?<\/section>/i.exec(html)?.[0] ?? '';

    assert.match(section, /<caption[^>]*>[\s\S]*?<\/caption>/i, 'the table needs a caption');
    assert.equal(
      (section.match(/<th\b/gi) ?? []).length,
      (section.match(/<th[^>]*scope="col"/gi) ?? []).length,
      'every queue column header must declare its scope',
    );
  });
});

describe('Stage 11 requirement 16: the renderer reaches the backend only through the bridge', () => {
  it('contains no backend, Firestore or transport vocabulary', () => {
    assertNoVocabulary(BACKEND_VOCABULARY, 'backend');
  });

  it('contains no Firebase SDK or Firestore SDK import of any kind', () => {
    // Named separately so the failure message says which SDK was found rather
    // than just "a forbidden token".
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      for (const sdk of ['firebase/app', 'firebase/firestore', 'firebase/auth', '@firebase', 'firestore()']) {
        assert.equal(code.includes(sdk), false, `the ${sdk} SDK is present in ${relativePath}`);
      }
    }
  });

  it('contains no Node.js API, no `require` and no `process`', () => {
    assertNoVocabulary(PLATFORM_VOCABULARY, 'platform');
  });

  it('contains no token, password or backend credential', () => {
    assertNoVocabulary(TOKEN_VOCABULARY, 'credential');
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      for (const secret of ['api_key', 'apikey', 'client_secret', 'private_key_id']) {
        assert.equal(code.includes(secret), false, `"${secret}" found in ${relativePath}`);
      }
      // The WORD `password` is legitimate - it is the id of the login input the
      // user types into. What must not exist is a password VALUE: a literal
      // assigned to an identifier NAMED `password`.
      //
      // The word boundary is load-bearing. `loginPassword: 'login-password'` is
      // an entry in the element-id map, and banning it would forbid the login
      // form itself; `loginpassword` has no boundary before `password`, so it is
      // correctly not matched.
      assert.equal(
        /\bpassword\b\s*[:=]\s*['"][^'"]+['"]/.test(code),
        false,
        `a hard-coded password literal is present in ${relativePath}`,
      );
      assert.equal(
        /signin\(\s*\{\s*email\s*:\s*['"][^'"]+['"]/.test(code),
        false,
        `a hard-coded sign-in identity is present in ${relativePath}`,
      );
    }
  });

  it('issues no raw IPC channel name from the renderer', () => {
    // The renderer may only name an OPERATION. A literal channel string such as
    // `drug-manager:orders:process` would mean it had learned the transport.
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      for (const forbidden of ['drug-manager:', 'ipcinvoke', 'invoke(', 'postmessage']) {
        assert.equal(code.includes(forbidden), false, `"${forbidden}" found in ${relativePath}`);
      }
    }
  });

  it('reads the bridge from the injected global and never fabricates one', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // The global is reached through a cast, so the guard matches the PROPERTY
    // rather than a literal `window.drugManager` that would not appear.
    assert.match(code, /\.drugmanager\b/, 'the bridge is the injected global');
    // An object literal shaped like the API would let the renderer fabricate a
    // success without ever reaching Main.
    assert.equal(
      /drugmanager\s*[:=]\s*\{/.test(code),
      false,
      'the renderer must not construct a bridge of its own',
    );
  });
});

describe('Stage 11 requirement 17: the renderer holds no Stage 6 algorithm', () => {
  it('contains no Stage 6 engine vocabulary, in source or in the shipped bundle', () => {
    assertNoVocabulary(ENGINE_VOCABULARY, 'engine');
  });

  it('constructs no transaction and opens no session of its own', () => {
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      for (const forbidden of ['begintransaction', 'commitwrites', 'rollback', 'precondition']) {
        assert.equal(code.includes(forbidden), false, `"${forbidden}" found in ${relativePath}`);
      }
    }
  });

  it('cannot write inventory: no stock key, no counter, no collection path', () => {
    assertNoVocabulary(WRITE_VOCABULARY, 'write');
  });

  it('sends exactly one field to the process operation: the request id', () => {
    // The load-bearing claim of this stage. If `orders.process` were ever called
    // with anything but an id, the renderer could steer a transaction - which is
    // precisely what Stage 6 exists to prevent.
    const code = readCode(join('src', 'renderer', 'renderer.ts'));
    const calls = [...code.matchAll(/orders\.process\(\s*\{([^}]*)\}/g)].map((match) => match[1] ?? '');

    assert.equal(calls.length >= 1, true, 'the renderer must process through orders.process');
    for (const body of calls) {
      const keys = [...body.matchAll(/(\w+)\s*:/g)].map((match) => match[1] ?? '').sort();
      assert.deepEqual(keys, ['requestid'], `only an id may be sent, got: ${body.trim()}`);
    }
  });

  it('reaches the orders module only through its named operations', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // `readCode` lower-cases, so the extracted operations are lower-case too.
    const used = [...code.matchAll(/api\.(\w+)\.(\w+)\(/g)].map((match) => `${match[1]}.${match[2]}`);
    // Stage 16 adds only the named employee submission operation. Processing
    // remains the distinct Stage 11 operation; no generic write is allowed.
    //
    // Stage 23 adds `orders.loadmore`, the READ-ONLY operation that continues
    // the Main-owned history cursor. It is a read, so the namespace still holds
    // exactly one write verb.
    const allowed = new Set([
      'orderrequests.list',
      'orderrequests.get',
      'orderrequests.submit',
      'orders.process',
      'orders.list',
      'orders.loadmore',
      'orders.myhistory',
    ]);

    for (const operation of used) {
      if (operation.startsWith('orderrequests.') || operation.startsWith('orders.')) {
        assert.equal(allowed.has(operation), true, `unexpected operation: ${operation}`);
      }
    }
    assert.equal(used.includes('orderrequests.get'), true, 'the single-request read must be used');
    assert.equal(used.includes('orders.process'), true, 'processing must be used');
    assert.equal(used.includes('orders.list'), true, 'the history read must be used');
  });
});
