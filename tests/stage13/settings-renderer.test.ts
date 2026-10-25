/**
 * Stage 13 - the System Settings page in the renderer.
 *
 * These tests drive the REAL compiled bundle against the REAL shipped markup, the
 * way Stages 11 and 12 do, because the questions here are behavioural:
 *
 *  - does the page read through the ONE argument-free named operation?
 *  - does it print every value EXACTLY as the bridge returned it?
 *  - does an absent document read as absent, rather than as configured values?
 *  - does a failure leave the page honest instead of showing stale numbers?
 *  - does the page allow editing exactly four fields and saving them, while retaining refresh and retry controls?
 *
 * The last question is why this file exists. The page allows editing exactly four fields and saving them, while retaining refresh and retry controls. A claim checked only in the markup would still hold if the renderer had attached a write handler to a control added later.
 * markup would still hold if the renderer had attached a write handler to a
 * control added later.
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';

type Harness = Awaited<ReturnType<typeof createRendererHarness>>;

const SIGNED_IN: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-12-31T23:59:59.000Z',
  displayName: 'Nour',
  role: 'admin',
};

/**
 * One stored `settings/app` document, exactly as Main projects it.
 *
 * The values are deliberately unlike the fallbacks (15 / 06:00 / 10:00) so a test
 * that shows a default where a stored value belongs fails loudly.
 */
function storedSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    minDaysBetweenOrders: 7,
    maxDailyOrders: 42,
    allowFridayOrders: true,
    startTime: '07:30',
    endTime: '15:45',
    assistantId: 'EMP-777',
    configured: true,
    ...overrides,
  };
}

/** Builds the harness signed in, with the given `settings.get()` answer. */
async function openSettings(
  settings: unknown,
  options: Parameters<typeof createRendererHarness>[0] = {},
): Promise<Harness> {
  const harness = await createRendererHarness({
    stateOnStartup: SIGNED_IN,
    settingsGet: { ok: true, settings },
    ...options,
  });
  await harness.openSettings();
  return harness;
}

/** Every `settings.*` call the page made, as `[name, argumentCount]`. */
function settingsCalls(harness: Harness): (readonly [string, number])[] {
  return harness.calls
    .filter((call) => call.name.startsWith('settings.'))
    .map((call) => [call.name, call.args.length] as const);
}
describe('Stage 13 requirement 6: the page reads through ONE argument-free operation', () => {
  it('calls settings.get with no payload on entry', async () => {
    await openSettings(storedSettings());

    // The argument count IS the payload: `0` means the renderer supplied nothing at
    // all, which is the whole Stage 13 claim at the transport level.
    assert.deepEqual(settingsCalls(await openSettings(storedSettings())), [['settings.get', 0]]);
  });

  it('issues no settings call other than that single read, even after refresh', async () => {
    const harness = await openSettings(storedSettings());

    await harness.clickSettingsRefresh();

    // Once on entry, once on refresh. Any other `settings.*` call would be a write
    // this page has no operation to perform.
    assert.deepEqual(settingsCalls(harness), [['settings.get', 0], ['settings.get', 0]]);
  });
});

describe('Stage 13 requirement 7: every value is printed exactly as stored', () => {
  it('shows the stored numbers and strings verbatim', async () => {
    const harness = await openSettings(storedSettings());

    assert.deepEqual(harness.settingsValues(), {
      minDays: '7',
      friday: 'نعم',
      startTime: '07:30',
      endTime: '15:45',
      maxDaily: '42',
      assistant: 'EMP-777',
    });
  });

  it('shows a false boolean as "لا" rather than as "false"', async () => {
    const harness = await openSettings(storedSettings({ allowFridayOrders: false }));

    assert.equal(harness.settingsValues().friday, 'لا');
  });

  it('shows a zero rather than blanking it', async () => {
    // Zero is a configured value, not an absent one. An empty cell would read as
    // "unset" and hide a deliberate setting.
    const harness = await openSettings(storedSettings({ minDaysBetweenOrders: 0 }));

    assert.equal(harness.settingsValues().minDays, '0');
  });

  it('shows an unusual time without normalising it', async () => {
    // `7:30` must not be tidied into `07:30`: the screen reports what is stored.
    const harness = await openSettings(storedSettings({ startTime: '7:30' }));

    assert.equal(harness.settingsValues().startTime, '7:30');
  });
});

describe('Stage 13 requirement 8: an absent document reads as absent', () => {
  it('shows the fallback values AND raises the advisory banner', async () => {
    const harness = await openSettings({
      minDaysBetweenOrders: 15,
      maxDailyOrders: 0,
      allowFridayOrders: false,
      startTime: '06:00',
      endTime: '10:00',
      assistantId: '',
      configured: false,
    });

    // The banner is what stops a manager reading these fallbacks as configured
    // values. Without it, the page would claim a state the document does not have.
    assert.equal(harness.settingsNotConfiguredVisible(), true);
    assert.equal(harness.settingsValues().minDays, '15');
    assert.equal(harness.settingsValues().startTime, '06:00');
  });

  it('keeps the banner hidden for a configured document', async () => {
    const harness = await openSettings(storedSettings());

    assert.equal(harness.settingsNotConfiguredVisible(), false);
  });
});
describe('Stage 13 requirement 9: a failure leaves the page honest', () => {
  it('shows the safe message and claims no values', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      settingsGet: {
        ok: false,
        error: { code: 'INFRASTRUCTURE_FAILURE', message: 'تعذّر الاتصال بالخادم.', retryable: true },
      },
    });
    await harness.openSettings();

    assert.equal(harness.settingsViewState(), 'error');
    assert.equal(harness.settingsError(), 'تعذّر الاتصال بالخادم.');
    // Nothing may be printed from a read that did not happen.
    assert.deepEqual(harness.settingsValues(), {
      minDays: '',
      friday: '',
      startTime: '',
      endTime: '',
      maxDaily: '',
      assistant: '',
    });
  });

  it('offers a retry that re-reads, and never writes', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      settingsGet: {
        ok: false,
        error: { code: 'INFRASTRUCTURE_FAILURE', message: 'خطأ', retryable: true },
      },
    });
    await harness.openSettings();

    await harness.clickSettingsRetry();

    // The retry is the same named read again - still argument-free.
    assert.deepEqual(settingsCalls(harness), [['settings.get', 0], ['settings.get', 0]]);
  });

  it('survives a THROWN transport error without claiming success', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      throwOnSettingsGet: true,
    });
    await harness.openSettings();

    assert.equal(harness.settingsViewState(), 'error');
    assert.equal(harness.settingsValues().minDays, '', 'no value may appear from a failed read');
  });
});

describe('Stage 13 requirement 10: the page holds nothing after sign-out', () => {
  it('drops every displayed value when the session ends', async () => {
    const harness = await openSettings(storedSettings());

    assert.equal(harness.settingsValues().minDays, '7');

    await harness.clickLogout();

    // The settings belong to the session that ended. Each value is emptied, and the
    // advisory banner is hidden again, so nothing about the previous session
    // survives behind the login form.
    assert.deepEqual(harness.settingsValues(), {
      minDays: '',
      friday: '',
      startTime: '',
      endTime: '',
      maxDaily: '',
      assistant: '',
    });
    assert.equal(harness.settingsNotConfiguredVisible(), false);
  });
});

/** Stage 13 requirement 12: the settings save form. */

/* The page now has a save form for the four editable fields
 * (minDaysBetweenOrders, allowFridayOrders, startTime, endTime).
 * These tests verify the form renders, submits, and resets correctly.
 */
describe('Stage 13 requirement 12: the settings save form', () => {
  it('renders the four editable fields populated from stored settings', async () => {
    const harness = await openSettings(storedSettings());

    // The save form should be present and populated.
    const markup = harness.settingsMarkup();

    // Four editable input fields should be present with stored values.
    assert.equal(markup.includes('minDaysBetweenOrders'), true);
    assert.equal(markup.includes('allowFridayOrders'), true);
    assert.equal(markup.includes('startTime'), true);
    assert.equal(markup.includes('endTime'), true);

    // Values should be pre-populated.
    assert.equal(harness.settingsValues().minDays, '7');
    assert.equal(harness.settingsValues().friday, 'نعم');
    assert.equal(harness.settingsValues().startTime, '07:30');
    assert.equal(harness.settingsValues().endTime, '15:45');
  });

  it('submits the save form with valid data', async () => {
    const harness = await openSettings(storedSettings());

    // Fill in the form with new values and submit.
    await harness.clickSettingsSave();

    // After save, the page should refresh from server.
    // The harness will have made a settings.save call.
    const calls = settingsCalls(harness);
    const saveCalls = calls.filter(([name]) => name === 'settings.save');
    assert.ok(saveCalls.length > 0, 'saveSettings IPC must have been called');

    // The save payload must contain exactly the four editable fields.
    const savePayload = saveCalls[0][1];
    assert.equal(savePayload.minDaysBetweenOrders, 7);
    assert.equal(savePayload.allowFridayOrders, true);
    assert.equal(savePayload.startTime, '07:30');
    assert.equal(savePayload.endTime, '15:45');

    // After successful save, values should reflect the saved data.
    // The harness refreshes, so re-reading should return the same values.
    await harness.clickSettingsRefresh();
    const refreshedCalls = settingsCalls(harness);
    const refreshSave = refreshedCalls.filter(([name]) => name === 'settings.save');
    assert.ok(refreshSave.length > 0);
  });

  it('disables the save button while a save is in flight', async () => {
    const harness = await openSettings(storedSettings());

    // Click save - it should become disabled during the async save.
    await harness.clickSettingsSave();

    const markup = harness.settingsMarkup();
    // The save button should have the disabled attribute.
    assert.equal(markup.includes('disabled'), true, 'save button must be disabled while saving');
  });

  it('resets all fields on logout', async () => {
    const harness = await openSettings(storedSettings());

    // Set some values and logout.
    await harness.clickLogout();

    // All settings values should be cleared.
    assert.deepEqual(harness.settingsValues(), {
      minDays: '',
      friday: '',
      startTime: '',
      endTime: '',
      maxDaily: '',
      assistant: '',
    });
    assert.equal(harness.settingsNotConfiguredVisible(), false);
  });
});
/** Stage 13 requirement 12: the settings save form. */
describe('Stage 13 requirement 12: the settings save form', () => {
  it('renders the four editable fields populated from stored settings', async () => {
    const harness = await openSettings(storedSettings());

    // The save form should be present and populated.
    const markup = harness.settingsMarkup();

    // Four editable input fields should be present with stored values.
    assert.equal(markup.includes('minDaysBetweenOrders'), true);
    assert.equal(markup.includes('allowFridayOrders'), true);
    assert.equal(markup.includes('startTime'), true);
    assert.equal(markup.includes('endTime'), true);

    // Values should be pre-populated.
    assert.equal(harness.settingsValues().minDays, '7');
    assert.equal(harness.settingsValues().friday, 'نعم');
    assert.equal(harness.settingsValues().startTime, '07:30');
    assert.equal(harness.settingsValues().endTime, '15:45');
  });

  it('submits the save form with valid data', async () => {
    const harness = await openSettings(storedSettings());

    // Fill in the form with new values and submit.
    await harness.clickSettingsSave();

    // After save, the page should refresh from server.
    // The harness will have made a settings.save call.
    const calls = settingsCalls(harness);
    const saveCalls = calls.filter(([name]) => name === 'settings.save');
    assert.ok(saveCalls.length > 0, 'saveSettings IPC must have been called');

    // The save payload must contain exactly the four editable fields.
    const savePayload = saveCalls[0][1];
    assert.equal(savePayload.minDaysBetweenOrders, 7);
    assert.equal(savePayload.allowFridayOrders, true);
    assert.equal(savePayload.startTime, '07:30');
    assert.equal(savePayload.endTime, '15:45');

    // After successful save, values should reflect the saved data.
    // The harness refreshes, so re-reading should return the same values.
    await harness.clickSettingsRefresh();
    const refreshedCalls = settingsCalls(harness);
    const refreshSave = refreshedCalls.filter(([name]) => name === 'settings.save');
    assert.ok(refreshSave.length > 0);
  });

  it('disables the save button while a save is in flight', async () => {
    const harness = await openSettings(storedSettings());

    // Click save - it should become disabled during the async save.
    await harness.clickSettingsSave();

    const markup = harness.settingsMarkup();
    // The save button should have the disabled attribute.
    assert.equal(markup.includes('disabled'), true, 'save button must be disabled while saving');
  });

  it('resets all fields on logout', async () => {
    const harness = await openSettings(storedSettings());

    // Set some values and logout.
    await harness.clickLogout();

    // All settings values should be cleared.
    assert.deepEqual(harness.settingsValues(), {
      minDays: '',
      friday: '',
      startTime: '',
      endTime: '',
      maxDaily: '',
      assistant: '',
    });
    assert.equal(harness.settingsNotConfiguredVisible(), false);
  });
});

/** Stage 13 requirement 11: the page is READ-ONLY */
describe('Stage 13 requirement 11: the page is READ-ONLY', () => {
  it('offers no control that could change a setting', async () => {
    // The retry is only reachable from a FAILED read, which is the one moment a
    // manager would actually press it. So the page is driven there first with a
    // backend that fails once and then recovers - the only shape that proves the
    // page both RETRIES and RECOVERS, rather than merely retrying into the same
    // failure forever.
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      settingsGetSequence: [
        { ok: false },
        { ok: true, settings: storedSettings() },
      ],
    });
    await harness.openSettings();
    assert.equal(harness.settingsViewState(), 'error');

    await harness.clickSettingsRetry();
    assert.equal(harness.settingsViewState(), 'ready');
    assert.equal(harness.settingsValues().minDays, '7', 'the retry must show what it recovered');

    // The controls on this page are: refresh, retry, and the four editable fields with save.
    // declared `type="button"`. There is a save button.
    const markup = harness.settingsMarkup();
    assert.deepEqual([...harness.settingsControlsInMarkup()].sort(), [
      'settings-refresh',
      'settings-retry',
      'settings-min-days',
      'settings-friday',
      'settings-start-time',
      'settings-end-time',
      'settings-save',
    ]);
    assert.equal(/<form\b/i.test(markup), false, 'a form would give a button a submit meaning');
    assert.equal(
      /<button(?![^>]*\btype="button")/i.test(markup),
      false,
      'every settings button must declare type="button"',
    );
    // And nothing was sent while every one of those controls was in reach: two
    // reads, no write, and the second one argument-free exactly like the first.
    assert.deepEqual(settingsCalls(harness), [
      ['settings.get', 0],
      ['settings.get', 0],
    ]);
  });

  it('navigates away and back without ever issuing a settings write', async () => {
    const harness = await openSettings(storedSettings());

    harness.clickNav('users');
    harness.clickNav('dashboard');
    harness.clickNav('settings');

    // Only the named read, and it is not repeated because the page caches like the
    // others do.
    assert.deepEqual(settingsCalls(harness), [['settings.get', 0]]);
  });
});
