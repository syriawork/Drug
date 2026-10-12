/**
 * Stage 14 - architecture guards for the READ-ONLY Stock Movement Audit surface.
 *
 * WHY THIS FILE EXISTS ALONGSIDE THE BEHAVIOURAL ONE: `stock-movements-renderer
 * .test.ts` proves what the page DOES with the data it receives. It cannot see
 * code that was never exercised. This file reads the SHIPPED ARTEFACTS and asserts
 * what they CONTAIN, which catches a class of regression behaviour alone cannot: a
 * second movement fetch, a quantity quietly summed, a balance computed from
 * `totalInward - totalOutward`, a Stage 6 rule re-implemented in the renderer, or
 * a control that writes.
 *
 * THE STRONGEST GUARD IN THIS FILE IS THE ARITHMETIC ONE. Every other audit screen
 * could be audited for "no write"; only this one can be audited for "no derived
 * number", because `stock_logs.quantity` is a POSITIVE MAGNITUDE in both
 * directions and `type` alone carries the sign. Any aggregation here would report
 * every outward movement as an inflow - a wrong number, not merely an invented one.
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
 * and cannot be defeated - or broken - by a helpful explanation.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

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

/** Asserts that no renderer artefact contains any of the given vocabulary. */
function assertNoVocabulary(vocabulary: readonly string[], label: string): void {
  for (const relativePath of scannedArtifacts()) {
    const code = readCode(relativePath);
    for (const token of vocabulary) {
      assert.equal(code.includes(token), false, `"${token}" (${label}) found in ${relativePath}`);
    }
  }
}

/**
 * The movement audit panel.
 *
 * HTML comments are stripped before the text is returned, because the panel
 * documents its own read-only design inside a comment and a text scan would read
 * that note as the very thing it denies.
 */
function stockMarkup(): string {
  const html = stripComments(readProjectFile(join('src', 'renderer', 'index.html')))
    .replace(/<!--[\s\S]*?-->/g, '');
  const start = html.indexOf('<section class="panel" id="stock-view"');
  assert.notEqual(start, -1, 'the shipped markup must contain the stock movement view');
  return html.slice(start, html.indexOf('</section>', start));
}
/**
 * Stage 14 specific: a read-only movement surface must not contain the machinery
 * a write needs. Every token here is something a WRITE would require and a READ
 * does not.
 *
 * The stored FIELD names are deliberately NOT in this list: this page exists to
 * display them, so banning the words would forbid the page itself. Field use is
 * checked precisely instead, by `assertFieldsAreOnlyRendered` below.
 */
const WRITE_VOCABULARY: readonly string[] = [
  // Write verbs on the stock namespace. This is the load-bearing one: a
  // `stockLogs.save` anywhere in the renderer would be a write with no channel.
  'stocklogs.save', 'stocklogs.update', 'stocklogs.set', 'stocklogs.delete',
  'stocklogs.create', 'stocklogs.write', 'stocklogs.patch', 'stocklogs.upsert',
  'stocklogs.append', 'stocklogssave',
  // The medicine WRITES. Moving stock is Stage 6's job and the mobile app's.
  // The bare verbs are matched on a word boundary, because `setStockState` - the
  // DISPLAY state helper of this very screen - starts with the same letters and is
  // not a write at all. A substring ban would fail the honest code.
  'medicines.updatemaxquantity', 'setmaxquantity', 'updatemedicinestock',
  'adjuststock', 'createmedicine', 'deletemedicine',
  // The Stage 6 engine ROUTINES. Stage 14 DISPLAYS what Stage 6 wrote; re-deciding
  // any of it here would be a second implementation of rules this stage was told to
  // leave alone.
  'aggregatelines', 'createorder', 'createstocklog', 'markrequestprocessed',
  'markrequestfailed', 'damascusmonthyear', 'validateusereligibility',
  'processorderrequest',
  // Transaction and write primitives.
  'begintransaction', 'commitwrites', 'writebatch', 'precondition', 'rollback',
  'updatemask', 'settoservervalue',
  // Collection paths: what must be impossible is ADDRESSING one for a write.
  'stock_logs/', 'medicines/', 'orders/', 'users/',
];

/**
 * DERIVED NUMBERS - the guard that makes this stage different from every other
 * read-only stage.
 *
 * `stock_logs.quantity` is a POSITIVE MAGNITUDE for BOTH directions (A4 stores
 * `Math.abs(diff)`), and `type` alone carries the sign. A renderer that summed the
 * column would therefore report every outward movement as an INFLOW. This is not
 * an invented number; it is a wrong one.
 *
 * These tokens are what summing, netting and balancing are made of. They are banned
 * from the MOVEMENT MODULE, not from the whole renderer, because an unrelated page
 * has no business summing stock movements either - but the login form legitimately
 * parses text, and a whole-file ban would pass for the wrong reason.
 *
 * `reduce` and `tally` are included because they are the two idiomatic ways a sum
 * gets written, and `totalinward`/`totaloutward` because the forbidden balance is
 * exactly `totalInward - totalOutward`.
 */
const DERIVED_NUMBER_VOCABULARY: readonly string[] = [
  'reduce(', '.reduce', 'tally(', '.tally',
  'totalinward', 'totaloutward', 'totalquantity', 'netquantity',
  'runningbalance', 'currentstock', 'balance',
  'sum(', '.sum', 'accumulate', 'runningtotal',
];

/**
 * ORDERING claims, scoped to the MOVEMENT MODULE.
 *
 * The REST transport has no `orderBy`, so the rows arrive in whatever order the
 * server returned. A sort call - or a `localeCompare` - would produce an ordering
 * that looks authoritative and that the backend never promised, which on an audit
 * trail is worse than showing no order at all.
 */
const ORDERING_VOCABULARY: readonly string[] = [
  'sort(', '.sort', 'localecompare', 'orderby', 'comparator',
  'newestfirst', 'oldestfirst', 'reverse()',
];

/**
 * The stored `stock_logs` field names, expressed as `movement.<field>` so the
 * check below is unambiguous rather than a word match anywhere in the renderer.
 *
 * `type` is deliberately absent from this list: it cannot be told apart from the
 * unrelated `password.type` in the login form, and a guard that flagged that would
 * be wrong rather than strict. The movement direction is still covered - by the
 * column-heading assertion and by the DERIVED_NUMBER guard, which is what would
 * actually catch a sign being applied to a magnitude.
 */
const MOVEMENT_FIELD_VOCABULARY: readonly string[] = [
  'movement.medicineId', 'movement.label', 'movement.quantity', 'movement.dateIso',
  'movement.actorUid', 'movement.requestId', 'movement.orderId',
];
/**
 * The movement module: every function that exists to serve the movement page.
 *
 * Gathered by their own declarations rather than by one contiguous slice, because
 * they are written in reading order rather than an order this test could assume.
 * Gathering by name means the guard keeps working if a function is moved, and it
 * states plainly that the claim covers the whole module.
 */
function stockModule(): string {
  const code = readCode(join('src', 'renderer', 'renderer.ts'));
  const parts: string[] = [];

  for (const name of [
    'stockmovementlabel', 'stockdatelabel', 'stockdescriptionlabel', 'stockreferencelabel',
    'visiblestockmovements', 'renderstockmovements', 'setstockstate', 'loadstockmovements',
    'applystockdirectionfilter',
  ]) {
    const start = code.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `the movement module must define ${name}()`);
    const next = code.slice(start + 1).search(/\n(?:async )?function [a-z]/);
    parts.push(next === -1 ? code.slice(start) : code.slice(start, start + 1 + next));
  }

  const module = parts.join('\n');
  // The gathered module must contain the read, or nothing above proved anything.
  assert.match(module, /api\.stocklogs\.list\(\)/, 'the movement module must perform the read');
  return module;
}

/**
 * Backend SDK, Node platform and credential vocabulary.
 *
 * The renderer reaches `stock_logs` through the typed preload bridge and nothing
 * else. These are the tokens any other route would need.
 */
const BACKEND_VOCABULARY: readonly string[] = [
  'firebase', 'firestore', 'googleapis', 'identitytoolkit', 'securetoken',
  'runquery', 'batchget', 'commitwrites',
  'stringvalue', 'integervalue', 'mapvalue', 'arrayvalue', 'timestampvalue',
  'structuredquery',
  'firebase/app', 'firebase/firestore', 'firebase/auth', '@firebase',
];

const PLATFORM_VOCABULARY: readonly string[] = [
  'require(', 'process.', 'module.exports',
  "from 'electron'", 'from "electron"', "require('electron",
  'ipcrenderer', 'webcontents', 'browserwindow',
  'localstorage', 'sessionstorage', 'indexeddb', 'document.cookie',
  '__dirname', '__filename', 'child_process',
];

const CREDENTIAL_VOCABULARY: readonly string[] = [
  'idtoken', 'refreshtoken', 'accesstoken', 'bearertoken', 'serviceaccount',
  'privatekey', 'credential', 'api_key', 'apikey', 'client_secret', 'private_key_id',
];

/**
 * Asserts that every stored movement field is only ever RENDERED.
 *
 * The shapes that could let a renderer DECIDE from a field are checked - an
 * assignment and a comparison - and the presentational use is left alone.
 */
function assertFieldsAreOnlyRendered(): void {
  const code = stripComments(readProjectFile(join('src', 'renderer', 'renderer.ts')));

  for (const field of MOVEMENT_FIELD_VOCABULARY) {
    const name = field.split('.')[1] ?? field;
    const occurrences = [...code.matchAll(new RegExp(`\\b${field}\\b`, 'g'))];
    assert.equal(
      occurrences.length >= 1,
      true,
      `"${name}" is displayed on this page, so it must appear as a movement field read`,
    );
    for (const occurrence of occurrences) {
      const lineStart = code.lastIndexOf('\n', occurrence.index);
      const lineEnd = code.indexOf('\n', occurrence.index);
      const text = code.slice(Math.max(lineStart, 0), lineEnd === -1 ? code.length : lineEnd);
      // Assignment: `movement.quantity =` - the screen editing what it read.
      assert.equal(
        new RegExp(`\\.${name}\\s*=[^=]`).test(text),
        false,
        `the renderer must not ASSIGN to the stored field "${name}": ${text.trim()}`,
      );
      // ORDERING comparison: `movement.quantity > 0` or `< 10`. A PRESENCE check
      // (`!== null`, or `.length > 0` on a string) is deliberately NOT flagged:
      // deciding whether to print an id or the neutral dash is display logic, and
      // a guard that failed honest code would be wrong rather than strict.
      //
      // What IS banned is comparing a stored NUMBER against a threshold, which is
      // where a "low stock" or "large movement" rule would start being invented by
      // the screen instead of read from the document.
      assert.equal(
        new RegExp(`\\.${name}\\s*(>=|<=|>|<)`).test(text),
        false,
        `the renderer must not COMPARE the stored number "${name}" against a threshold: ${text.trim()}`,
      );
      // Arithmetic: `movement.quantity * 2` or `+movement.quantity` - the screen
      // computing with a stored magnitude. This is the exact shape that would turn
      // an audit trail into an inventory report.
      assert.equal(
        new RegExp(`[+*/-]\\s*${field}\\b`).test(text),
        false,
        `the renderer must not do ARITHMETIC on the stored field "${name}": ${text.trim()}`,
      );
    }
  }
}
describe('Stage 14: the movement audit screen reaches the backend only through the typed bridge', () => {
  it('contains no Firebase SDK and no raw wire vocabulary', () => {
    assertNoVocabulary(BACKEND_VOCABULARY, 'backend SDK');
  });

  it('contains no Node.js platform API and no raw IPC', () => {
    // `ipcRenderer` is the load-bearing token here: the renderer must go through
    // the preload bridge, never talk to the transport itself.
    assertNoVocabulary(PLATFORM_VOCABULARY, 'platform');
  });

  it('contains no credential or token vocabulary', () => {
    assertNoVocabulary(CREDENTIAL_VOCABULARY, 'credential');
  });

  it('keeps the MOVEMENT module free of any write path', () => {
    // SCOPED TO THE MODULE, deliberately. `assertNoVocabulary` over the whole
    // renderer would be wrong here, not merely inconvenient: the Stage 10
    // medicines screen legitimately calls `api.medicines.updateMaxQuantity`, and
    // banning that token file-wide would fail a screen that is correct. What must
    // be impossible is the MOVEMENT page writing - so that is what is checked.
    const module = stockModule();

    for (const token of WRITE_VOCABULARY) {
      // A WORD BOUNDARY, so `setStockState` is not read as the write `setStock`.
      // Without it the guard would fail this screen's own honest display helper,
      // and a test that has to be loosened to pass teaches nobody anything.
      const pattern = new RegExp(`(?<![a-z])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`);
      assert.equal(
        pattern.test(module),
        false,
        `"${token}" found in the movement module: this page is read-only`,
      );
    }
  });

  it('computes NO derived quantity, and never a balance', () => {
    // THE load-bearing guard of this stage. `quantity` is a positive magnitude in
    // both directions, so a sum here would report outward movements as inflows.
    const module = stockModule();

    for (const token of DERIVED_NUMBER_VOCABULARY) {
      assert.equal(
        module.includes(token),
        false,
        `"${token}" found in the movement module: the page must show stored rows, never a derived number`,
      );
    }
  });

  it('claims no ordering, because the transport cannot order', () => {
    const module = stockModule();

    for (const token of ORDERING_VOCABULARY) {
      assert.equal(
        module.includes(token),
        false,
        `"${token}" found in the movement module: no orderBy exists, so no order may be implied`,
      );
    }
  });

  it('reaches Main through the read operation and nothing else', () => {
    const module = stockModule();
    const operations = [...module.matchAll(/api\.(\w+)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`);

    // The check is on the PAIR, not the namespace: `stockLogs.list` is the
    // module's own operation, so banning the namespace would ban the read. The
    // source is lower-cased by `readCode`, so the expectation matches that.
    assert.deepEqual(
      [...new Set(operations)],
      ['stocklogs.list'],
      `the movement module must reach Main through stockLogs.list only, found: ${operations.join(', ')}`,
    );
  });
});

describe('Stage 14: the movement audit screen is READ-ONLY in the shipped markup', () => {
  it('offers no form and no submit control', () => {
    const section = stockMarkup();

    assert.equal(/<form\b/i.test(section), false, 'the movement panel must contain no form');
    assert.equal(/type="submit"/i.test(section), false, 'the movement panel must have no submit control');
    assert.equal(
      /<button(?![^>]*\btype="button")/i.test(section),
      false,
      'every movement button must declare type="button"',
    );
  });

  it('ships no editable control that could change a movement', () => {
    const section = stockMarkup().toLowerCase();

    // The search box and the direction filter ARE inputs - and both are read-only
    // display controls that filter already-loaded rows. What must not appear is
    // anything that could EDIT a value: `contenteditable`, or a numeric field.
    assert.equal(
      section.includes('contenteditable'),
      false,
      'the movement panel must contain no contenteditable region',
    );
    assert.equal(
      /<input[^>]*type="(number|range|checkbox)"/i.test(section),
      false,
      'the movement panel must contain no editable or toggleable control',
    );
    // And no control whose id or name suggests saving, creating or adjusting.
    for (const verb of ['save', 'create', 'delete', 'adjust', 'apply', 'submit']) {
      assert.equal(
        section.includes(verb),
        false,
        `the movement panel must contain no control named "${verb}"`,
      );
    }
  });

  it('renders only stored fields, and decides from none of them', () => {
    assertFieldsAreOnlyRendered();
  });

  it('exposes exactly the columns the stored document has', () => {
    const section = stockMarkup();
    const headings = [...section.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((match) => match[1]?.replace(/<[^>]*>/g, '').trim() ?? '')
      .filter((text) => text.length > 0);

    // Seven columns, each one a field that EXISTS in the document: medicineId,
    // the stored label, type, quantity, date, actorUid and the order/request
    // reference. A "balance" or "total" column would be a number the database
    // never stored, so its absence is asserted rather than merely left unmentioned.
    assert.deepEqual(headings, [
      'رقم الدواء',
      'الوصف المخزَّن',
      'الاتجاه',
      'الكمية المخزَّنة',
      'تاريخ الحركة',
      'المنفّذ',
      'المرجع',
    ]);
  });
});