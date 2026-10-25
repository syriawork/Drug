/**
 * Stage 13 - the application layer for the System Settings page.
 *
 * WHAT THIS FILE PROVES
 * The settings page reads through `manager.getSettings()` and writes through
 * `manager.saveSettings()`, both projecting on the shared `AppSettingsView` /
 * `AppSettingsViewDraft` types. What this suite does is pin the behaviour the
 * page depends on, so a change to the SHARED read or write path cannot
 * silently alter what the screen shows:
 *
 *  - every stored field reaches the view EXACTLY as stored, with no transformation
 *  - an ABSENT document is reported as absent (`configured: false`) and shows the
 *    fallbacks the processing step really would apply - not blanks and not guesses
 *  - the two DEAD fields pass through untouched on read, and are preserved from
 *    the stored document on write (they are never sent by the renderer)
 *  - `saveSettings` merges the four editable fields into the stored document,
 *    leaving `maxDailyOrders` and `assistantId` from the current record
 *  - a failure is an honest failure, with nothing leaked
 *
 * The real `toAppSettingsView` and `toAppSettingsDraft` are used, not copies, so
 * a test that passes here describes what the shipped projection does.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createManagerApplication } from '../../electron/application';
import type { AppSettings } from '../../electron/domain/models';
import { FakeSettingsRepository, rulesDenied } from '../stage7/helpers/fakes';

const SIGNED_IN: SafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-12-31T23:59:59.000Z',
  displayName: 'Nour',
  role: 'admin',
};

// The signed-out shape still carries the full field set; only the flag differs.
const SIGNED_OUT: SafeAuthState = {
  authenticated: false,
  uid: '',
  email: '',
  emailVerified: false,
  expirationTimeIso: '',
  displayName: null,
  role: null,
};

/**
 * Builds the application over ONE settings repository the caller keeps a handle on.
 *
 * The other repositories are irrelevant to this suite and are passed as `never`:
 * the settings read touches none of them, and supplying working fakes would only
 * make a test pass for the wrong reason if one of them were ever reached.
 *
 * The repository is a parameter rather than something built inside, because two of
 * the claims below are about how OFTEN it is reached. A helper that created its own
 * would make those assertions vacuous - a count of zero on an instance nobody
 * injected proves nothing about the instance the application actually used.
 */
function applicationOver(
  repository: FakeSettingsRepository,
  session: SafeAuthState = SIGNED_IN,
): ReturnType<typeof createManagerApplication> {
  return createManagerApplication({
    session: {
      getSafeState: () => session,
      signInWithEmailAndPassword: async () => {
        throw new Error('the suite never signs in through the application');
      },
      signOut: () => undefined,
    },
    usersRepository: undefined as never,
    medicinesRepository: undefined as never,
    orderRequestsRepository: undefined as never,
    ordersRepository: undefined as never,
    orderProcessing: undefined as never,
    settingsRepository: repository,
    // Stage 14: the settings read touches none of these, so they are placeholders.
    stockLogsRepository: undefined as never,
    // Stage 15: same - the settings read reaches no transaction.
    inboundStockTransactionFactory: undefined as never,
  });
}

/** The convenience form: build a repository the suite does not need to inspect. */
function applicationFor(
  settings: AppSettings | null,
  failure: Error | null = null,
  session: SafeAuthState = SIGNED_IN,
): ReturnType<typeof createManagerApplication> {
  return applicationOver(new FakeSettingsRepository(settings, failure), session);
}

/** A stored document with values chosen so any transformation would be visible. */
function storedSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    minDaysBetweenOrders: 7,
    maxDailyOrders: 42,
    allowFridayOrders: true,
    startTime: '07:30',
    endTime: '15:45',
    assistantId: 'EMP-777',
    ...overrides,
  };
}
describe('Stage 13 requirement 1: every stored field reaches the view unchanged', () => {
  it('passes all six fields through with no transformation', async () => {
    const result = await applicationFor(storedSettings()).manager.getSettings();

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : null, {
      minDaysBetweenOrders: 7,
      maxDailyOrders: 42,
      allowFridayOrders: true,
      startTime: '07:30',
      endTime: '15:45',
      assistantId: 'EMP-777',
      configured: true,
    });
  });

  it('keeps an unusual time verbatim rather than normalising it', async () => {
    // A screen that "tidied" `7:30` into `07:30` would be reporting a value the
    // system never stored. The stored string is what the screen shows.
    const result = await applicationFor(storedSettings({ startTime: '7:30', endTime: '9:05' }))
      .manager.getSettings();

    assert.equal(result.ok ? result.value.startTime : null, '7:30');
    assert.equal(result.ok ? result.value.endTime : null, '9:05');
  });

  it('keeps a zero rather than replacing it with a default', async () => {
    // Zero is a real configured value here, not an absent one. Collapsing it would
    // hide a deliberate setting.
    const result = await applicationFor(storedSettings({ minDaysBetweenOrders: 0 })).manager.getSettings();

    assert.equal(result.ok ? result.value.minDaysBetweenOrders : null, 0);
    assert.equal(result.ok ? result.value.configured : null, true);
  });

  it('preserves an empty assistant id as an empty string', async () => {
    const result = await applicationFor(storedSettings({ assistantId: '' })).manager.getSettings();

    assert.equal(result.ok ? result.value.assistantId : null, '');
  });
});

describe('Stage 13 requirement 2: an absent document is reported as absent', () => {
  it('reports configured: false and fills the A2 fallbacks', async () => {
    const result = await applicationFor(null).manager.getSettings();

    assert.equal(result.ok, true, 'a missing document is a readable state, not a failure');
    assert.equal(result.ok ? result.value.configured : null, false);
    // These are the values the processing step would itself apply. The view shows
    // them rather than blanks, because blanks would read as "unset" and hide what
    // the system will actually enforce.
    assert.equal(result.ok ? result.value.minDaysBetweenOrders : null, 15);
    assert.equal(result.ok ? result.value.startTime : null, '06:00');
    assert.equal(result.ok ? result.value.endTime : null, '10:00');
  });

  it('does not mark a present document as unconfigured', async () => {
    const result = await applicationFor(storedSettings()).manager.getSettings();

    assert.equal(result.ok ? result.value.configured : null, true);
  });
});
describe('Stage 13 requirement 3: the DEAD fields pass through untouched (M1)', () => {
  it('reports maxDailyOrders exactly as the read layer produced it', async () => {
    // M1, decided and NOT to be reconciled here: `views.ts` and `order-mapper.ts`
    // disagree on this field's fallback (0 versus 50). This stage deliberately
    // changes neither, so the value below is whatever the current read path yields
    // for a document that does not exist. The page displays it beside `configured`
    // and under a "غير مُفعّل" label.
    const result = await applicationFor(null).manager.getSettings();

    assert.equal(result.ok, true);
    // The disagreement is asserted as it stands, so a change to either side has to
    // be a deliberate edit here too.
    assert.equal(result.ok ? result.value.maxDailyOrders : null, 0);
  });

  it('reports a STORED maxDailyOrders as stored, whatever it is', async () => {
    const result = await applicationFor(storedSettings({ maxDailyOrders: 99 })).manager.getSettings();

    assert.equal(result.ok ? result.value.maxDailyOrders : null, 99);
  });

  it('reports assistantId as stored, including a value the mobile app ignores', async () => {
    const result = await applicationFor(storedSettings({ assistantId: 'EMP-000' })).manager.getSettings();

    assert.equal(result.ok ? result.value.assistantId : null, 'EMP-000');
  });
});

describe('Stage 13 requirement 4: failures are honest and leak nothing', () => {
  it('turns a rules denial into a safe failure', async () => {
    const result = await applicationFor(storedSettings(), rulesDenied('settings/app')).manager.getSettings();

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('settings/app'), false, 'no document path may leak');
    assert.equal(serialized.toLowerCase().includes('permission'), false);
  });

  it('survives an infrastructure failure without inventing values', async () => {
    const result = await applicationFor(storedSettings(), new Error('socket hang up')).manager.getSettings();

    assert.equal(result.ok, false, 'a thrown transport error must not be reported as a success');
    assert.equal(!result.ok ? result.error.message.includes('socket hang up') : true, false);
  });

  it('refuses when there is no session, WITHOUT reaching the repository', async () => {
    // The repository instance is the one the application actually holds, not a fresh
    // one the helper built for itself. A count of zero on an instance nobody injected
    // would pass even if the guard were removed and the read really happened.
    const repository = new FakeSettingsRepository(storedSettings());

    const result = await applicationOver(repository, SIGNED_OUT).manager.getSettings();

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHENTICATION_FAILED');
    assert.equal(repository.calls, 0, 'the guard must refuse BEFORE any read is attempted');
  });
});

describe('Stage 13 requirement 5: the settings surface offers read and write', () => {
  it('exposes exactly two settings operations on the application surface', () => {
    const application = applicationFor(storedSettings());
    const settingsMembers = Object.getOwnPropertyNames(
      Object.getPrototypeOf(application.manager),
    ).filter((name) => name.toLowerCase().includes('setting'));

    // One read, one write.
    assert.deepEqual(settingsMembers, ['getSettings', 'saveSettings']);
  });

  it('reaches the repository once per read, and once per write', async () => {
    const repository = new FakeSettingsRepository(storedSettings());

    const readResult = await applicationOver(repository).manager.getSettings();
    assert.equal(readResult.ok, true);
    assert.equal(repository.calls, 1, 'one read, one repository call');

    const writeResult = await applicationOver(repository).manager.saveSettings({
      minDaysBetweenOrders: 3,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });
    assert.equal(writeResult.ok, true);
    assert.equal(repository.calls, 2, 'a second call for the save');
  });

  it('never sends the dead fields to the repository on save', async () => {
    const repository = new FakeSettingsRepository(storedSettings());

    const result = await applicationOver(repository).manager.saveSettings({
      minDaysBetweenOrders: 3,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, true);
    const saved = repository.lastSaved;
    assert.equal(saved?.minDaysBetweenOrders, 3);
    assert.equal(saved?.allowFridayOrders, false);
    assert.equal(saved?.startTime, '08:00');
    assert.equal(saved?.endTime, '17:00');
    // The dead fields come from the stored document, never from the draft.
    assert.equal(saved?.maxDailyOrders, 42);
    assert.equal(saved?.assistantId, 'EMP-777');
  });

  it('preserves dead fields from defaults when no document exists', async () => {
    const repository = new FakeSettingsRepository(null);

    const result = await applicationOver(repository).manager.saveSettings({
      minDaysBetweenOrders: 3,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, true);
    const saved = repository.lastSaved;
    assert.equal(saved?.minDaysBetweenOrders, 3);
    assert.equal(saved?.allowFridayOrders, false);
    assert.equal(saved?.startTime, '08:00');
    assert.equal(saved?.endTime, '17:00');
    assert.equal(saved?.maxDailyOrders, 0);
    assert.equal(saved?.assistantId, '');
  });

  it('rejects a malformed draft without reaching the repository', async () => {
    const repository = new FakeSettingsRepository(storedSettings());

    const result = await applicationOver(repository).manager.saveSettings({
      minDaysBetweenOrders: -1,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, false);
    assert.equal(repository.calls, 0, 'validation failure must not touch the repository');
  });

  it('accepts 0 as minDaysBetweenOrders', async () => {
    const repository = new FakeSettingsRepository(storedSettings());

    const result = await applicationOver(repository).manager.saveSettings({
      minDaysBetweenOrders: 0,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, true, '0 must be accepted as a valid minDaysBetweenOrders');
    assert.equal(repository.calls, 1, '0 must reach the repository');
  });

  it('accepts values greater than 365 as minDaysBetweenOrders', async () => {
    const repository = new FakeSettingsRepository(storedSettings());

    const result = await applicationOver(repository).manager.saveSettings({
      minDaysBetweenOrders: 400,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, true, '400 must be accepted as a valid minDaysBetweenOrders (no upper limit)');
    assert.equal(repository.calls, 1, '400 must reach the repository');
  });

  it('rejects fractional minDaysBetweenOrders', async () => {
    const repository = new FakeSettingsRepository(storedSettings());

    const result = await applicationOver(repository).manager.saveSettings({
      minDaysBetweenOrders: 1.5,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, false, '1.5 must be rejected: minDaysBetweenOrders must be an integer');
    assert.equal(repository.calls, 0, 'fractional rejection must not reach the repository');
  });

  it('rejects non-numeric minDaysBetweenOrders', async () => {
    const repository = new FakeSettingsRepository(storedSettings());

    const result = await applicationOver(repository).manager.saveSettings({
      minDaysBetweenOrders: 'abc' as unknown as number,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, false, '"abc" must be rejected: minDaysBetweenOrders must be a number');
    assert.equal(repository.calls, 0, 'non-numeric rejection must not reach the repository');
  });

  it('refuses when there is no session, WITHOUT reaching the repository', async () => {
    const repository = new FakeSettingsRepository(storedSettings());

    const result = await applicationOver(repository, SIGNED_OUT).manager.saveSettings({
      minDaysBetweenOrders: 3,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHENTICATION_FAILED');
    assert.equal(repository.calls, 0, 'the guard must refuse BEFORE any write is attempted');
  });

  it('turns a rules denial into a safe failure', async () => {
    const result = await applicationFor(storedSettings(), rulesDenied('settings/app')).manager.saveSettings({
      minDaysBetweenOrders: 3,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('settings/app'), false, 'no document path may leak');
    assert.equal(serialized.toLowerCase().includes('permission'), false);
  });

  it('survives an infrastructure failure without inventing values', async () => {
    const result = await applicationFor(storedSettings(), new Error('socket hang up')).manager.saveSettings({
      minDaysBetweenOrders: 3,
      allowFridayOrders: false,
      startTime: '08:00',
      endTime: '17:00',
    });

    assert.equal(result.ok, false, 'a thrown transport error must not be reported as a success');
    assert.equal(!result.ok ? result.error.message.includes('socket hang up') : true, false);
  });
});
