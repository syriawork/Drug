/**
 * Stage 13 - architecture guards for the READ-ONLY System Settings surface.
 *
 * WHY THIS FILE EXISTS ALONGSIDE THE BEHAVIOURAL ONE: `settings-renderer.test.ts`
 * proves what the page DOES with the data it receives. It cannot see code that was
 * never exercised. This file reads the SHIPPED ARTEFACTS and asserts what they
 * CONTAIN, which catches a class of regression behaviour alone cannot: a second
 * settings fetch, a value quietly normalised before display, a Stage 6 rule
 * re-implemented in the renderer, a control that writes.
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
import { assertSettingsFieldsAreOnlyRendered } from '../helpers/settings-field-guard';
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
 * The settings panel and the navigation entry that opens it.
 *
 * HTML comments are stripped before the text is returned, because the panel
 * documents its own read-only design inside a comment and a text scan would read
 * that note as the very thing it denies.
 */
function settingsMarkup(): string {
  const html = stripComments(readProjectFile(join('src', 'renderer', 'index.html')))
    .replace(/<!--[\s\S]*?-->/g, '');
  const start = html.indexOf('<section class="panel" id="settings-view"');
  assert.notEqual(start, -1, 'the shipped markup must contain the settings view');
  return html.slice(start, html.indexOf('</section>', start));
}
/**
 * Stage 13 specific: a read-only surface must not contain the machinery a write
 * needs. Every token here is something a WRITE would require and a READ does not.
 *
 * The stored FIELD names are deliberately NOT in this list: this page exists to
 * display them, so banning the words would forbid the page itself. Field use is
 * checked precisely instead, by `assertFieldsAreOnlyRendered` below.
 */
const WRITE_VOCABULARY: readonly string[] = [
  // Write verbs on the settings namespace. This is the load-bearing one: a
  // `settings.save` anywhere in the renderer would be a write with no channel.
  'settings.save', 'settings.update', 'settings.set', 'settings.delete', 'settings.create',
  'settings.write', 'settings.patch', 'settings.upsert',
  // The Stage 6 engine ROUTINES. Stage 13 DISPLAYS what Stage 6 decided; re-deciding
  // any of it here would be a second implementation of rules this stage was told to
  // leave alone.
  'aggregatelines', 'createorder', 'createstocklog', 'updatemedicinestock',
  'markrequestprocessed', 'markrequestfailed', 'damascusmonthyear',
  'validateusereligibility', 'processorderrequest',
  // Transaction and write primitives.
  'begintransaction', 'commitwrites', 'writebatch', 'precondition', 'rollback',
  'updatemask', 'settoservervalue',
  // Collection paths: what must be impossible is ADDRESSING one for a write.
  'stock_logs', 'medicines/', 'users/', 'settings/app',
];

/**
 * The stored `settings/app` field names, checked for RENDER-ONLY access rather than
 * banned outright.
 *
 * WHY THEY ARE NOT BANNED: this stage exists to show these values, so the words must
 * appear in the renderer. What must not appear is any USE that could change a
 * decision: an assignment, a comparison, or an argument to something that writes.
 *
 * SCOPE OF THE CLAIM, stated precisely: passing a field to `String()` or to
 * `booleanLabel()` is rendering. Assigning one, comparing one, or passing one to a
 * function this cannot classify as rendering is not something the test allows.
 */
const SETTINGS_FIELD_VOCABULARY: readonly string[] = [
  'minDaysBetweenOrders', 'maxDailyOrders', 'allowFridayOrders',
  'startTime', 'endTime', 'assistantId',
];

/**
 * Time PARSING and NORMALISING, scoped to the SETTINGS MODULE.
 *
 * This page shows the stored clock strings. Turning "07:30" into a number of
 * minutes, reordering it, or substituting a default would let the screen disagree
 * with the document - exactly the class of bug M1 exists to prevent.
 *
 * SCOPE, stated precisely: these tokens are legitimate elsewhere in the renderer -
 * the login form parses a typed field. So they are banned only inside the settings
 * loader and renderer, where a parse could only mean "the screen re-decided a value
 * the document already decided". A whole-file ban would forbid code this stage is
 * not responsible for and would pass for the wrong reason.
 */
const TIME_MATH_VOCABULARY: readonly string[] = [
  'tominutes', 'minutesofday', 'parsetime', 'padstart(', 'gethours', 'getminutes',
  'newdate(', 'split(":', "split(':", 'timesplit', 'normalizeTime',
];

/**
 * The settings module: every function that exists to serve the settings page.
 *
 * The four functions are gathered by their own declarations rather than by one
 * contiguous slice, because they are written in reading order - renderer, label
 * helper, state, loader - not in an order this test could assume. Gathering by name
 * means the guard keeps working if a function is moved, and it states plainly that
 * the claim covers the whole module.
 */
function settingsModule(): string {
  const code = readCode(join('src', 'renderer', 'renderer.ts'));
  const parts: string[] = [];

  for (const name of ['rendersettings', 'booleanlabel', 'setsettingsstate', 'loadsettings']) {
    const start = code.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `the settings module must define ${name}()`);
    // Run to the start of the next top-level declaration, which is where this
    // function's body ends.
    const next = code.slice(start + 1).search(/\n(?:async )?function [a-z]/);
    parts.push(next === -1 ? code.slice(start) : code.slice(start, start + 1 + next));
  }

  const module = parts.join('\n');
  // The gathered module must contain the read, or nothing above proved anything.
  assert.match(module, /api\.settings\.get\(\)/, 'the settings module must perform the read');
  return module;
}

/**
 * Backend SDK, Node platform and credential vocabulary.
 *
 * The renderer reaches the settings document through the typed preload bridge and
 * nothing else. These are the tokens any other route would need.
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
 * Asserts that every stored settings field is only ever RENDERED.
 *
 * The three shapes that could let a renderer DECIDE from a field are checked - an
 * assignment, a comparison, and an argument to anything that is not a text setter -
 * and the presentational use is left alone.
 */
function assertFieldsAreOnlyRendered(): void {
  const code = stripComments(readProjectFile(join("src", "renderer", "renderer.ts")));
  assertSettingsFieldsAreOnlyRendered(code, SETTINGS_FIELD_VOCABULARY, "source renderer.ts");
}
describe('Stage 13 requirement 15: the settings page ships as a real Arabic RTL region', () => {
  it('keeps the RTL direction and the Arabic language on the shell', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.match(html, /<html[^>]*\blang="ar"/i, 'the document must declare Arabic');
    assert.match(html, /<html[^>]*\bdir="rtl"/i, 'the document must be right-to-left');
    assert.match(html, /<meta[^>]*charset="utf-8"/i, 'Arabic requires an explicit UTF-8');
  });

  it('marks the settings panel up as a real Arabic region, not an empty shell', () => {
    const section = settingsMarkup();

    // Arabic content is required: an English-only region would pass a structural
    // check while shipping a page its own users cannot read.
    assert.match(section, /[\u0600-\u06FF]/, 'the settings panel must contain Arabic text');
    // Each stored field has its own labelled element, so every value has a place to
    // be shown and a test has an id to read.
    for (const id of [
      'settings-min-days',
      'settings-friday',
      'settings-start-time',
      'settings-end-time',
      'settings-max-daily',
      'settings-assistant',
    ]) {
      assert.match(section, new RegExp(`id="${id}"`), `the panel must declare id="${id}"`);
    }
    assert.match(section, /id="settings-not-configured"/, 'the advisory banner must exist');
    assert.match(section, /id="settings-refresh"/, 'the refresh control must exist');
    assert.match(section, /id="settings-retry"/, 'the retry control must exist');
  });

  it('labels every value with a term, so a number is never shown unlabelled', () => {
    const section = settingsMarkup();

    // Six `<dt>` term elements for six values. A definition list whose terms were
    // dropped would leave a screen of bare numbers with nothing to explain them.
    assert.match(section, /<dl\b/i, 'the values must be marked up as a definition list');
    assert.equal(
      [...section.matchAll(/<dt\b/gi)].length,
      6,
      'every displayed value needs a term describing it',
    );
    assert.equal(
      [...section.matchAll(/<dd\b/gi)].length,
      6,
      'every term needs exactly one value beside it',
    );
  });

  it('renders the times and the assistant id left-to-right', () => {
    const css = readProjectFile(join('src', 'renderer', 'styles.css'));

    // "07:30" and "EMP-777" are Latin-numeral values inside an RTL page. Without an
    // explicit LTR run the browser reorders the pieces, and a manager reading
    // "30:07" is looking at a time that does not exist.
    assert.match(css, /direction\s*:\s*ltr/i, 'the stylesheet must declare an LTR run for LTR values');
    assert.match(css, /\bunicode-bidi\b/i, 'an LTR run needs bidi isolation to render inside RTL');
  });

  it('declares a navigation entry, labelled in Arabic', () => {
    const html = readProjectFile(join('src', 'renderer', 'index.html'));

    assert.match(html, /data-view="settings"/, 'the shell must offer a settings navigation entry');
    // The label is wrapped in a `<span>` on its own line, so the pattern allows the
    // markup between the attribute and the text rather than demanding adjacency.
    assert.match(
      html,
      /data-view="settings"[\s\S]{0,120}?>\s*<span[^>]*>\s*الإعدادات\s*<\/span>/,
      'the navigation entry must be labelled in Arabic',
    );
  });
});
describe('Stage 13 requirement 16: the settings page reaches the backend only through the typed bridge', () => {
  it('contains no backend, Firestore or SDK vocabulary', () => {
    assertNoVocabulary(BACKEND_VOCABULARY, 'backend');
  });

  it('contains no Node.js API, no require and no process', () => {
    assertNoVocabulary(PLATFORM_VOCABULARY, 'platform');
  });

  it('contains no token, password or backend credential', () => {
    assertNoVocabulary(CREDENTIAL_VOCABULARY, 'credential');
  });

  it('issues no raw IPC channel name from the renderer', () => {
    // The renderer may only name an OPERATION. A literal channel string would mean
    // it had learned the transport.
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
    // A literal shaped like the view would let the renderer display settings that
    // were never stored, which is the one way a read-only page could show a value
    // the document does not hold.
    assert.equal(
      /drugmanager\s*[:=]\s*\{/.test(code),
      false,
      'the renderer must not construct a bridge of its own',
    );
  });

  it('calls settings.get with NO argument, wherever it is called', () => {
    // The load-bearing transport claim. A payload here would let the renderer aim
    // the read; an empty call means the backend alone decides which document is read.
    //
    // EXISTENCE and EMPTINESS are asserted separately on purpose. HTML and CSS are
    // scanned for the second rule but not the first: they are expected to contain
    // no call at all, and forcing one to exist there would be nonsense.
    for (const relativePath of [join('src', 'renderer', 'renderer.ts'), BUNDLE_PATH]) {
      assert.equal(
        /settings\.get\(/.test(readCode(relativePath)),
        true,
        `the settings read must be used in ${relativePath}`,
      );
    }
    for (const relativePath of scannedArtifacts()) {
      const code = readCode(relativePath);
      for (const call of code.matchAll(/settings\.get\(([^)]*)\)/g)) {
        assert.equal(
          (call[1] ?? '').trim(),
          '',
          `settings.get must take no argument, got: settings.get(${(call[1] ?? '').trim()})`,
        );
      }
    }
  });

  it('reaches the settings module ONLY through get', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // `readCode` lower-cases, so the extracted operations are lower-case too.
    const used = [...code.matchAll(/api\.(\w+)\.(\w+)\(/g)].map((match) => `${match[1]}.${match[2]}`);

    for (const operation of used) {
      if (operation.startsWith('settings.')) {
        assert.equal(operation, 'settings.get', `unexpected operation: ${operation}`);
      }
    }
    assert.equal(used.includes('settings.get'), true, 'the settings read must be used');
  });
});
describe('Stage 13 requirement 17: the settings page holds no write and no Stage 6 algorithm', () => {
  it('renders the stored fields without ever deciding from them', () => {
    assertFieldsAreOnlyRendered();
  });

  it('contains no write machinery, no settings write verb and no collection path', () => {
    assertNoVocabulary(WRITE_VOCABULARY, 'write');
  });

  it('never parses, reorders or normalises a stored time', () => {
    // The times are shown as stored. Parsing them into minutes here would let the
    // screen disagree with the document, which is the bug class M1 exists to stop.
    const module = settingsModule();

    for (const token of TIME_MATH_VOCABULARY) {
      assert.equal(
        module.includes(token.toLowerCase()),
        false,
        `"${token}" found in the settings module: the page must show times as stored`,
      );
    }
  });

  it('offers no form, and no control that could submit one', () => {
    const section = settingsMarkup();

    // A form would give a button a submit meaning and make Enter in any future
    // field navigate - turning a read into a submission.
    assert.equal(/<form\b/i.test(section), false, 'the settings panel must contain no form');
    assert.equal(
      /<button(?![^>]*\btype="button")/i.test(section),
      false,
      'every settings button must declare type="button"',
    );
    assert.equal(/type="submit"/i.test(section), false, 'the settings panel must have no submit control');
  });

  it('ships no editable control of any kind', () => {
    const section = settingsMarkup();

    // The strongest form of the read-only claim: with no `<input>`, `<select>` or
    // `<textarea>` on the page there is nothing for a user to change and nothing for
    // a submission to carry. This is asserted on the MARKUP, so a control added later
    // fails here rather than being discovered in production.
    for (const control of ['<input', '<select', '<textarea', 'contenteditable']) {
      assert.equal(
        section.toLowerCase().includes(control),
        false,
        `the settings panel must contain no ${control} control`,
      );
    }
  });

  it('keeps the settings module free of any write call', () => {
    const module = settingsModule();

    // The whole settings module, from its loader to the end of its renderer, is
    // checked: a write appearing there would be a write this read-only page could
    // reach, and the markup would show no control for it.
    for (const forbidden of ['api.settings.save', 'api.settings.update', 'api.settings.set', 'api.settings.delete']) {
      assert.equal(module.includes(forbidden), false, `the settings module must not call ${forbidden}`);
    }
    // And the module reaches Main through exactly one call, the read. The check is on
    // the PAIR, not on the namespace: `settings.get` is the module's own call, so
    // banning the namespace outright would ban the one operation it exists to make.
    const operations = [...module.matchAll(/api\.(\w+)\.(\w+)\(/g)].map((match) => `${match[1]}.${match[2]}`);

    assert.deepEqual(
      [...new Set(operations)],
      ['settings.get'],
      `the settings module must reach Main through settings.get only, found: ${operations.join(', ')}`,
    );
  });

  it('never writes the settings it read back into the DOM as a value', () => {
    const code = readCode(join('src', 'renderer', 'renderer.ts'));

    // The cache may hold the view so a re-render is free, but the only thing that
    // may be done with it is read. An assignment into it, or a write to the loaded
    // settings object, is where "the screen edits what it shows" would begin.
    assert.match(code, /let loadedappsettings/, 'the page caches the loaded settings');
    assert.equal(
      /loadedappsettings\s*=[^=]*\.(minDaysBetweenOrders|maxDailyOrders|allowFridayOrders|startTime|endTime|assistantId)/.test(code),
      false,
      'the renderer must never assign into a stored settings field',
    );
  });
});
