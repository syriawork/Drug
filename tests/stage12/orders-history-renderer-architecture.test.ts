/**
 * Stage 12 - architecture guards for the read-only Orders History surface.
 *
 * WHY THIS FILE EXISTS ALONGSIDE THE BEHAVIOURAL ONE: `orders-history-renderer.test.ts`
 * proves what the page DOES with the data it receives. It cannot see code that was
 * never exercised. This file reads the SHIPPED ARTEFACTS and asserts what they
 * CONTAIN, which catches a class of regression behaviour alone cannot: a second
 * fetch, a month recomputed from an ISO date, an aggregation of quantities, a
 * control that writes. Each is easy to add later and invisible to any test that
 * only drives the controls which exist today.
 *
 * TWO ARTEFACTS ARE SCANNED, not one:
 *   1. the SOURCE under `src/renderer/`, which is what a reviewer reads, and
 *   2. the COMPILED BUNDLE `dist/renderer/renderer.js` that actually ships.
 *
 * Scanning only the source would leave a gap where a build step, a copied file or an
 * edit straight into `dist/` put code into the shipped artefact that no source guard
 * can see. The bundle is the real thing, so the real thing is read.
 *
 * Comments are stripped before every scan, so a guard reads CODE rather than prose
 * and cannot be defeated (or broken) by a helpful explanation.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assertSettingsFieldsAreOnlyRendered } from '../helpers/settings-field-guard';

const projectRoot = join(__dirname, '..', '..', '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

/** The shipped renderer bundle: the artefact a user's machine actually loads. */
const BUNDLE_PATH = join('dist', 'renderer', 'renderer.js');

/**
 * Removes line and block comments while respecting string literals.
 *
 * A naive line-comment stripper would corrupt any string containing a double slash
 * - such as a URL - and could silently delete real code, turning a finding into no
 * finding at all. The scanner tracks quotes so a double slash inside a literal is
 * kept as part of the literal.
 */
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
/** The CODE of a project file, with code and HTML comments removed, lower-cased. */
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
 * Every artefact that must be free of a forbidden token.
 *
 * The bundle is included deliberately and is checked for existence first, so a
 * missing build fails loudly here instead of silently skipping the strongest guard
 * in the file.
 */
function scannedArtifacts(): readonly string[] {
  assert.equal(
    existsSync(join(projectRoot, BUNDLE_PATH)),
    true,
    `the shipped bundle is missing: ${BUNDLE_PATH}. Run "npm run build" first.`,
  );
  return [...RENDERER_FILES, BUNDLE_PATH];
}


/**
 * Asserts that every stored settings field is only ever RENDERED.
 *
 * WHY THIS SHAPE INSTEAD OF A WORD BAN: Stage 13 exists to display these fields,
 * so the words themselves are legitimate. What must not exist is any use that
 * could make the renderer DECIDE something from them. This checks the three
 * shapes that could do that - an assignment, a comparison, and an argument to
 * anything that is not a text setter - and leaves the presentational use alone.
 *
 * SCOPE OF THE CLAIM, stated precisely: passing a field to `String()` or to
 * `booleanLabel()` is rendering. Assigning to one, comparing one, or passing one
 * to a function this cannot classify is not something this test allows.
 */
function assertFieldsAreReadOnly(): void {
  const code = stripComments(readProjectFile(join("src", "renderer", "renderer.ts")));
  assertSettingsFieldsAreOnlyRendered(code, SETTINGS_FIELD_VOCABULARY, "source renderer.ts");
}

/** Asserts that no renderer artefact contains any of the given vocabulary. */
function assertNoVocabulary(vocabulary: readonly string[], label: string): void {
  for (const relativePath of scannedArtifacts()) {
    const code = readCode(relativePath);
    for (const token of vocabulary) {
      assert.equal(code.includes(token), false, `"${token}" (${label}) found in ${relativePath}`);
    }
  }
}

/** The section of `index.html` that is the history panel, or an empty string. */
function historyMarkup(): string {
  const html = readProjectFile(join('src', 'renderer', 'index.html'));
  return /<section[^>]*id="orders-history-view"[\s\S]*?<\/section>/i.exec(html)?.[0] ?? '';
}

/** The section of `index.html` that is the read-only details dialog. */
function historyDialogMarkup(): string {
  const html = readProjectFile(join('src', 'renderer', 'index.html'));
  return /<dialog[^>]*id="order-history-dialog"[\s\S]*?<\/dialog>/i.exec(html)?.[0] ?? '';
}

/**
 * Stage 12 specific: a read-only surface must not contain the machinery a write
 * needs. Every token here is something a WRITE would require and a READ does not.
 *
 * NOTE ON WHAT IS AND IS NOT IN THIS LIST. It holds ALGORITHM names and write
 * primitives only. It deliberately does NOT hold the stored FIELD names
 * (`minDaysBetweenOrders`, `startTime`, ...): those are data the domain defines,
 * and Stage 13 is required to DISPLAY them read-only, so banning the words would
 * forbid a page this project is meant to ship. Field access is checked precisely
 * instead, by `assertFieldsAreReadOnly` below, which proves the fields are only
 * ever rendered - never compared, assigned or used to make a decision.
 */
const WRITE_VOCABULARY: readonly string[] = [
  // The Stage 6 engine ROUTINES. Stage 12 reads documents Stage 6 already wrote;
  // re-deciding any of it here would be a second implementation.
  'aggregatelines', 'createorder', 'createstocklog', 'updatemedicinestock',
  'markrequestprocessed', 'markrequestfailed', 'damascusmonthyear',
  'validateusereligibility',
  // Transaction and write primitives.
  'begintransaction', 'commitwrites', 'writebatch', 'precondition', 'rollback',
  // Collection paths: what must be impossible is ADDRESSING one for a write.
  'stock_logs', 'medicines/', 'users/', 'settings/',
];

/**
 * Stored `settings/app` field names, checked for READ-ONLY access rather than
 * banned outright.
 *
 * WHY THEY ARE NOT BANNED: Stage 13 exists to show these values, so the words must
 * appear in the renderer. What must not appear is any USE that could change a
 * decision: a comparison, an assignment, or an argument to something that writes.
 *
 * The check below therefore looks for the shapes that would let a renderer act on
 * a field, and allows the one shape that is purely presentational - passing the
 * value straight into a text setter.
 */
const SETTINGS_FIELD_VOCABULARY: readonly string[] = [
  'minDaysBetweenOrders', 'maxDailyOrders', 'allowFridayOrders',
  'startTime', 'endTime', 'assistantId',
];

/**
 * The quantities of a stored order, and the vocabulary of a computed total.
 *
 * Item quantities MUST appear in the renderer - the details dialog prints each
 * stored line. What must not appear is any way of COMBINING them. The count is
 * printed from `itemCount`, which Stage 6 computed once, and summing again here
 * would produce a second total that could silently disagree with the stored one.
 */
const AGGREGATION_VOCABULARY: readonly string[] = [
  '.reduce(', 'reduce((', 'accumulator', 'totalquantity', 'sumquantity',
  'quantitysum', 'grandtotal', 'totalsquantity',
];

/** Date maths: the month is a STORED field, never recomputed from the ISO date. */
const DATE_MATH_VOCABULARY: readonly string[] = [
  'getmonth()', 'getfullyear()', 'toutoisostring', 'toisostring()',
  'substr(0, 7)', 'slice(0, 7)',
];
// __APPEND_HERE__
describe('Stage 12 requirement 15: the history page ships as a real Arabic RTL region', () => {
  it('keeps the RTL direction and the Arabic language on the shell', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.match(html, /<html[^>]*\blang="ar"/i, 'the document must declare Arabic');
    assert.match(html, /<html[^>]*\bdir="rtl"/i, 'the document must be right-to-left');
    assert.match(html, /<meta[^>]*charset="utf-8"/i, 'Arabic requires an explicit UTF-8');
  });

  it('marks the history panel up as a real Arabic region, not an empty shell', () => {
    const section = historyMarkup();

    assert.notEqual(section, '', 'the shipped markup must contain the orders-history view');
    // Arabic content is required: an English-only region would pass a structural
    // check while shipping a page its own users cannot read.
    assert.match(section, /[\u0600-\u06FF]/, 'the history panel must contain Arabic text');
    assert.match(section, /id="orders-history-rows"/, 'the history table body must exist');
    assert.match(section, /id="orders-history-search-input"/, 'the search control must exist');
    assert.match(section, /id="orders-history-status-filter"/, 'the status filter must exist');
    assert.match(section, /id="orders-history-refresh"/, 'the refresh control must exist');
    assert.match(section, /id="orders-history-retry"/, 'the retry control must exist');
  });

  it('labels the history table with a caption and scoped column headers', () => {
    const section = historyMarkup();

    assert.match(section, /<caption[^>]*>[\s\S]*?<\/caption>/i, 'the table needs a caption');
    assert.equal(
      (section.match(/<th\b/gi) ?? []).length,
      (section.match(/<th[^>]*scope="col"/gi) ?? []).length,
      'every history column header must declare its scope',
    );
  });

  it('ships the details dialog as a real dialog element with an accessible name', () => {
    const dialog = historyDialogMarkup();

    assert.notEqual(dialog, '', 'the shipped markup must contain the order-history dialog');
    assert.match(dialog, /aria-labelledby="order-history-dialog-title"/, 'the dialog needs a name');
    assert.match(dialog, /[\u0600-\u06FF]/, 'the dialog must contain Arabic text');
  });

  it('gives the count column its own class so it cannot read as a quantity sum', () => {
    const css = readProjectFile(join('src', 'renderer', 'styles.css'));
    // The class is applied by the RENDERER when it builds a row, so the
    // authoritative place to look for it is the code, not the static markup.
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    assert.match(code, /'cell-number'/, 'the renderer must tag the count cell distinctly');
    assert.match(
      css,
      /#orders-history-rows td\.cell-number/,
      'the count column must be styled distinctly from the text columns',
    );
    assert.match(css, /#orders-history-view/, 'the history panel must be styled');
    assert.match(css, /#order-history-dialog/, 'the history dialog must be styled');
  });

  it('offers only ghost and icon controls - nothing that looks like a write', () => {
    const scope = `${historyMarkup()}${historyDialogMarkup()}`;
    const classes = [...scope.matchAll(/<button[^>]*class="([^"]*)"/g)].map((match) => match[1] ?? '');

    assert.equal(classes.length >= 3, true, 'the history surface must have its controls');
    for (const className of classes) {
      // A `button-primary` on a read-only page would advertise an action the page
      // deliberately does not have. Ghost and icon are the only acceptable looks.
      assert.equal(
        /button-primary|button-danger/.test(className),
        false,
        `a write-looking control is present: ${className}`,
      );
    }
  });
});
describe('Stage 12 requirement 16: the history page reaches the backend only through the typed bridge', () => {
  it('contains no backend, Firestore or transport vocabulary', () => {
    assertNoVocabulary(
      [
        'firebase', 'firestore', 'googleapis', 'identitytoolkit', 'securetoken',
        'runquery', 'batchget', 'commitwrites',
        'stringvalue', 'integervalue', 'mapvalue', 'arrayvalue', 'timestampvalue',
        'updatemask', 'settoservervalue', 'structuredquery',
      ],
      'backend',
    );
  });

  it('contains no Firebase SDK or Firestore SDK import of any kind', () => {
    // Named separately so the failure message says WHICH SDK was found rather
    // than just "a forbidden token".
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      for (const sdk of ['firebase/app', 'firebase/firestore', 'firebase/auth', '@firebase', 'firestore()']) {
        assert.equal(code.includes(sdk), false, `the ${sdk} SDK is present in ${relativePath}`);
      }
    }
  });

  it('contains no Node.js API, no require and no process', () => {
    assertNoVocabulary(
      [
        'require(', 'process.', 'module.exports',
        "from 'electron'", 'from "electron"', "require('electron",
        'ipcrenderer', 'webcontents', 'browserwindow',
        'localstorage', 'sessionstorage', 'indexeddb', 'document.cookie',
        '__dirname', '__filename', 'child_process',
      ],
      'platform',
    );
  });

  it('contains no token, password or backend credential', () => {
    assertNoVocabulary(
      ['idtoken', 'refreshtoken', 'accesstoken', 'bearertoken', 'serviceaccount', 'privatekey', 'credential'],
      'credential',
    );
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      for (const secret of ['api_key', 'apikey', 'client_secret', 'private_key_id']) {
        assert.equal(code.includes(secret), false, `"${secret}" found in ${relativePath}`);
      }
    }
  });

  it('issues no raw IPC channel name from the renderer', () => {
    // The renderer may only name an OPERATION. A literal channel string such as
    // `drug-manager:orders:list` would mean it had learned the transport.
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      for (const forbidden of ['drug-manager:', 'ipcinvoke', 'invoke(', 'postmessage']) {
        assert.equal(code.includes(forbidden), false, `"${forbidden}" found in ${relativePath}`);
      }
    }
  });

  it('reads the bridge from the injected global and never fabricates one', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    assert.match(code, /\.drugmanager\b/, 'the bridge is the injected global');
    // An object literal shaped like the API would let the renderer fabricate a
    // success without ever reaching Main - which, for a read-only page, is the one
    // way it could display rows that do not exist.
    assert.equal(
      /drugmanager\s*[:=]\s*\{/.test(code),
      false,
      'the renderer must not construct a bridge of its own',
    );
  });

  it('calls orders.list with NO argument, wherever it is called', () => {
    // The load-bearing transport claim of this stage. A payload here would let the
    // renderer steer the query; an empty call means the backend alone decides what
    // "the history" is.
    //
    // EXISTENCE and EMPTINESS are asserted separately on purpose. HTML and CSS are
    // scanned for the second rule but not the first: they are expected to contain
    // no call at all, and forcing one to exist there would be nonsense.
    for (const relativePath of [join('src', 'renderer', 'renderer.ts'), BUNDLE_PATH]) {
      assert.equal(
        /orders\.list\(/.test(readCode(relativePath)),
        true,
        "the history read must be used in ${relativePath}",
      );
    }
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      const calls = [...code.matchAll(/orders\.list\(([^)]*)\)/g)];

      for (const call of calls) {
        assert.equal(
          (call[1] ?? '').trim(),
          '',
          "orders.list must take no argument, got: orders.list(${(call[1] ?? '').trim()})",
        );
      }
    }
  });

  it('reaches the orders module ONLY through list and the Stage 11 write', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // `readCode` lower-cases, so the extracted operations are lower-case too.
    const used = [...code.matchAll(/api\.(\w+)\.(\w+)\(/g)].map((match) => `${match[1]}.${match[2]}`);
    // `orders.process` belongs to the Stage 11 QUEUE page, not the history page.
    // It may exist in this file because it is a different screen; the history
    // module itself is guarded against calling it in the next block.
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
    assert.equal(used.includes('orders.list'), true, 'the history read must be used');
  });
});
describe('Stage 12 requirement 17: the history page holds no write and no Stage 6 algorithm', () => {

  it('renders the stored settings fields without ever deciding from them', () => {
    // Stage 13 added a page that DISPLAYS `settings/app`. The guard therefore
    // narrowed from a word ban to a use check: the fields must be read to be
    // shown, and must never be assigned, compared or fed to anything that
    // could change a decision.
    assertFieldsAreReadOnly();
  });
  it('contains no write machinery, no stock key and no collection path', () => {
    assertNoVocabulary(WRITE_VOCABULARY, 'write');
  });

  it('never aggregates item quantities - the count is stored, not summed', () => {
    assertNoVocabulary(AGGREGATION_VOCABULARY, 'aggregation');
  });

  it('never recomputes the month from the ISO date', () => {
    // The month is a field Stage 6 stored. Recomputing it here would reintroduce
    // the Damascus calendar rules this stage was told to leave alone, in a second
    // place, where nothing tests them against the original.
    assertNoVocabulary(DATE_MATH_VOCABULARY, 'date maths');
  });

  it('prints the stored item COUNT rather than a computed total', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    assert.match(code, /string\(order\.itemcount\)/, 'the row count must come from itemCount');
  });

  it('keeps the Stage 11 processing write out of the history module', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));
    // orders.process belongs to the Stage 11 QUEUE page. It may exist in this
    // file because it is a different screen, so the guard is positional: the
    // single call must come BEFORE the history module begins. A write appearing
    // after that point would be a write this read-only page could reach, and the
    // markup would show no control for it.
    const writeCalls = [...code.matchAll(/api\.orders\.process\(/g)];

    assert.equal(writeCalls.length, 1, 'exactly one processing call is expected');
    const writeIndex = writeCalls[0]?.index ?? -1;
    const historyIndex = code.indexOf('function loadorderhistory');

    assert.notEqual(historyIndex, -1, 'the history loader must exist');
    assert.equal(
      writeIndex < historyIndex,
      true,
      'the processing write must stay outside the history module',
    );
  });

  it('offers no form, and no control that could submit one', () => {
    const scope = `${historyMarkup()}${historyDialogMarkup()}`;

    // A form in this scope would give a button a submit meaning and make Enter in
    // the search box navigate - turning a local filter into a submit.
    assert.equal(/<form\b/i.test(scope), false, 'the history surface must contain no form');
    assert.equal(
      /<button(?![^>]*\btype="button")/i.test(scope),
      false,
      'every history button must declare type="button"',
    );
  });

  it('ships no delete, edit, process or save control on the history surface', () => {
    const scope = `${historyMarkup()}${historyDialogMarkup()}`;

    // Asserted against the SHIPPED MARKUP, so a control added later fails here
    // rather than being discovered by a user in production.
    assert.equal(/type="submit"/i.test(scope), false, 'the history surface must have no submit control');
    for (const forbidden of ['???', '?????', '???', '??????']) {
      assert.equal(scope.includes(forbidden), false, `a "${forbidden}" control is present in the markup`);
    }
  });
});

describe('Stage 12: the history page filters locally and re-queries nothing', () => {
  it('filters over the already-loaded rows, not over a fresh request', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // `visibleOrderHistory` is the single source of what is on screen, and it reads
    // `loadedOrderHistory` - the array the ONE read filled. A filter that reached
    // the backend would need a second `orders.list`, and the behavioural suite
    // already proves it makes none.
    assert.match(code, /function visibleorderhistory\(\)/, 'the history filter must exist');
    assert.match(
      code,
      /const all = loadedorderhistory \?\? \[\]/,
      'the filter must run over the rows already in memory',
    );
    assert.equal(
      /visibleorderhistory\(\)[^}]*orders\.list/.test(code),
      false,
      'the filter must not issue a request',
    );
  });

  it('restricts the status filter to the statuses Stage 6 actually stores', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // An allow-list, not an if/else chain: a new stored status must fail to appear
    // as a filter option until someone deliberately adds it.
    assert.match(code, /order_history_filter_values/, 'the filter values must be an allow-list');
    for (const status of ['pending', 'accepted', 'rejected']) {
      assert.match(
        code,
        new RegExp(`order_history_filter_values[\\s\\S]{0,300}'${status}'`),
        `"${status}" must be an accepted filter value`,
      );
    }
  });
});


