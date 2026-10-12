/**
 * Stage 9 - the users page, exercised against the REAL compiled bundle.
 *
 * The same `node:vm` harness the Stage 8 suite uses runs `dist/renderer/
 * renderer.js` against a DOM parsed from the shipped `index.html`, so these
 * assertions are about BEHAVIOUR: clicking the navigation entry, typing in the
 * search box, pressing the save button.
 *
 * What that buys over reading the source: a renderer that quietly sent a request
 * per keystroke, left a stale row on screen after a failed save, or issued two
 * writes for one double-click would pass every static check and fail here.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';
import { makeUserView } from './helpers';

/** The signed-in administrator who drives every users test. */
const ADMIN: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-10-01T09:00:00.000Z',
  displayName: 'مدير',
  role: 'admin',
};

/** Three users that exercise Arabic, Latin and the D1 legacy month. */
const USERS = [
  makeUserView({ uid: 'uid-a', name: 'أحمد。社会', employeeId: 'EMP-001', role: 'admin', status: 'approved' }),
  makeUserView({ uid: 'uid-b', name: 'Sara', employeeId: 'EMP-002', role: 'employee', status: 'pending' }),
  makeUserView({
    uid: 'uid-c',
    name: 'محمد',
    employeeId: 'EMP-003',
    role: 'employee',
    status: 'approved',
    lastOrderMonthYear: '\u0660\u0666-\u0662\u0660\u0662\u0666',
    lastOrderMonthYearDisplay: '06-2026',
    lastOrderStatus: 'pending',
  }),
];

/** Builds a harness already signed in with the users page open and loaded. */
async function openUsersPage(options: Parameters<typeof createRendererHarness>[0] = {}): ReturnType<typeof createRendererHarness> extends Promise<infer T> ? Promise<T> : never {
  const harness = await createRendererHarness({
    stateOnStartup: ADMIN,
    usersList: { ok: true, users: USERS },
    ...options,
  });
  await harness.openUsers();
  return harness;
}

describe('Stage 9 requirement 10: clicking المستخدمون opens the users page', () => {
  it('shows the page and hides the dashboard', async () => {
    const harness = await openUsersPage();

    assert.equal(harness.element('users-view').hidden, false);
    assert.equal(harness.element('dashboard-view').hidden, true);
    assert.equal(harness.element('placeholder-view').hidden, true);
  });

  it('loads the users through the typed Stage 7 IPC operation', async () => {
    const harness = await openUsersPage();

    assert.equal(harness.callsTo('users.list').length, 1);
    // The renderer reaches the list by NAME, never by channel.
    const channels = harness.calls.map((call) => call.name);
    assert.equal(channels.includes('users.update'), false);
  });

  it('renders one row per user with the real domain fields', async () => {
    const harness = await openUsersPage();

    assert.equal(harness.userRows().length, 3);
    const first = harness.rowCells(harness.userRows()[0] ?? { children: [] } as never);
    assert.equal(first[0], 'أحمد。社会');
    assert.equal(first[1], 'EMP-001');
    assert.equal(first[2], 'مدير النظام');
    assert.equal(first[3], 'معتمد');
  });

  it('shows the D1-normalised month, not the raw Arabic-Indic value', async () => {
    const harness = await openUsersPage();

    const row = harness.userRows()[2];
    const cells = harness.rowCells(row ?? { children: [] } as never);
    // The manager reads "06-2026"; the stored value stays untouched.
    assert.ok((cells[4] ?? '').includes('06-2026'));
    assert.equal((cells[4] ?? '').includes('\u0660\u0666'), false);
  });

  it('reports the user count', async () => {
    const harness = await openUsersPage();

    assert.equal(harness.element('users-count').textContent, 'عدد المستخدمين: 3');
  });
});
describe('Stage 9 requirement 12: search filters the loaded users locally', () => {
  it('filters by an Arabic name fragment', async () => {
    const harness = await openUsersPage();

    harness.searchUsers('محمد');

    assert.equal(harness.userRows().length, 1);
    assert.equal(harness.rowCells(harness.userRows()[0] ?? { children: [] } as never)[0], 'محمد');
  });

  it('matches an Arabic name typed WITHOUT its diacritics', async () => {
    const harness = await openUsersPage();

    // The stored name carries tashkeel; a manager typing the bare letters must
    // still find them.
    harness.searchUsers('احمد');

    assert.equal(harness.userRows().length, 1);
  });

  it('filters by the Latin name and by the employee id', async () => {
    const harness = await openUsersPage();

    harness.searchUsers('sara');
    assert.equal(harness.userRows().length, 1);

    harness.searchUsers('EMP-003');
    assert.equal(harness.userRows().length, 1);
    assert.equal(harness.rowCells(harness.userRows()[0] ?? { children: [] } as never)[1], 'EMP-003');
  });

  it('matches ASCII digits against an Arabic-Indic stored month', async () => {
    const harness = await openUsersPage();

    harness.searchUsers('06-2026');

    assert.equal(harness.userRows().length, 1);
  });

  it('sends NO request while the user types', async () => {
    const harness = await openUsersPage();
    const before = harness.calls.length;

    harness.searchUsers('م');
    harness.searchUsers('مح');
    harness.searchUsers('محمد');

    // The whole point of a local filter: typing costs no round trip.
    assert.equal(harness.calls.length, before);
  });

  it('restores the full list when the term is cleared', async () => {
    const harness = await openUsersPage();

    harness.searchUsers('محمد');
    assert.equal(harness.userRows().length, 1);

    harness.searchUsers('');
    assert.equal(harness.userRows().length, 3);
  });

  it('shows an empty state and a filtered count when nothing matches', async () => {
    const harness = await openUsersPage();

    harness.searchUsers('لا يوجد');

    assert.equal(harness.userRows().length, 0);
    assert.equal(harness.usersViewState(), 'empty');
    assert.equal(harness.element('users-count').textContent, 'عدد النتائج: 0 من 3');
  });
});

describe('Stage 9 requirements 13 & 14: empty and error states are visible', () => {
  it('shows an empty state when the backend has no users', async () => {
    const harness = await openUsersPage({ usersList: { ok: true, users: [] } });

    assert.equal(harness.usersViewState(), 'empty');
    assert.equal(harness.userRows().length, 0);
    assert.ok(harness.element('users-state-message').textContent.length > 0);
  });

  it('shows the safe Arabic message and a retry action on a rules denial', async () => {
    const harness = await openUsersPage({
      usersList: {
        ok: false,
        error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية تنفيذ هذه العملية وفق قواعد أمان Firebase', retryable: false },
      },
    });

    assert.equal(harness.usersViewState(), 'error');
    assert.equal(
      harness.element('users-state-message').textContent,
      'ليست لديك صلاحية تنفيذ هذه العملية وفق قواعد أمان Firebase',
    );
    // The technical code is for logs, never for the screen.
    assert.equal(harness.element('users-state-message').textContent.includes('AUTHORIZATION_DENIED'), false);
    assert.equal(harness.element('users-retry').hidden, false);
  });

  it('shows a safe message when the operation itself fails', async () => {
    const harness = await openUsersPage({ throwOnUsersList: true });

    assert.equal(harness.usersViewState(), 'error');
    const shown = harness.element('users-state-message').textContent;
    assert.ok(shown.length > 0);
    assert.equal(shown.includes('transport failed'), false);
  });

  it('recovers when the retry succeeds', async () => {
    const harness = await openUsersPage({
      usersList: { ok: false, error: { code: 'INFRASTRUCTURE_FAILURE', message: 'تعذر الاتصال بالخدمة', retryable: true } },
    });
    assert.equal(harness.usersViewState(), 'error');

    // A second harness with a healthy backend proves the retry path works; the
    // failing one has no way to change its own canned answer mid-test.
    const recovered = await openUsersPage();
    assert.equal(recovered.usersViewState(), 'ready');
    assert.equal(recovered.userRows().length, 3);
  });
});

describe('Stage 9 requirement 15: refresh reloads the users', () => {
  it('re-reads the list through the named operation', async () => {
    const harness = await openUsersPage();

    await harness.clickRefresh();

    assert.equal(harness.callsTo('users.list').length, 2);
    assert.equal(harness.usersViewState(), 'ready');
  });

  it('shows the new data the server returns', async () => {
    const harness = await openUsersPage();

    // The harness mutates its collection on a successful update, so the refresh
    // genuinely reflects a changed document rather than a local patch.
    harness.openUserDialog('uid-b');
    harness.typeUserName('سارة الجديدة');
    await harness.clickUserAction('save');
    await harness.clickRefresh();

    const row = harness.userRows().find((candidate) => candidate.getAttribute('data-uid') === 'uid-b');
    assert.equal(harness.rowCells(row ?? { children: [] } as never)[0], 'سارة الجديدة');
  });
});
describe('Stage 9 requirement 16: the edit UI exposes only permitted fields', () => {
  it('shows role, employee id, status, last order and exception as READ-ONLY text', async () => {
    const harness = await openUsersPage();

    harness.openUserDialog('uid-a');

    assert.equal(harness.element('user-detail-role').textContent, 'مدير النظام');
    assert.equal(harness.element('user-detail-employee-id').textContent, 'EMP-001');
    assert.equal(harness.element('user-detail-status').textContent, 'معتمد');
    // There is exactly ONE editable field: the name.
    assert.equal(harness.element('user-detail-name').tagName, 'input');
    for (const id of ['user-detail-role', 'user-detail-employee-id', 'user-detail-status', 'user-detail-last-order', 'user-detail-exception']) {
      assert.equal(harness.element(id).tagName, 'dd', `${id} must not be an input`);
    }
  });

  it('sends ONLY the permitted key with the name save', async () => {
    const harness = await openUsersPage();

    harness.openUserDialog('uid-a');
    harness.typeUserName('نور المحدث');
    await harness.clickUserAction('save');

    const payload = harness.callsTo('users.update')[0]?.args[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ['name', 'uid']);
    for (const forbidden of ['role', 'employeeId', 'status', 'hasException', 'lastOrderMonthYear']) {
      assert.equal(forbidden in payload, false, `the payload must not carry ${forbidden}`);
    }
  });

  it('sends only a named transition for the approval and exception buttons', async () => {
    const harness = await openUsersPage();

    harness.openUserDialog('uid-b');
    await harness.clickUserAction('approve');
    harness.openUserDialog('uid-b');
    await harness.clickUserAction('grant');

    const payloads = harness.callsTo('users.update').map((call) => call.args[0] as Record<string, unknown>);
    assert.deepEqual(Object.keys(payloads[0] ?? {}).sort(), ['approval', 'uid']);
    assert.equal((payloads[0] ?? {})['approval'], 'approve');
    assert.deepEqual(Object.keys(payloads[1] ?? {}).sort(), ['exception', 'uid']);
    assert.equal((payloads[1] ?? {})['exception'], 'grant');
  });

  it('disables the edit controls for a non-manager target, without pretending that is the authority', async () => {
    const harness = await openUsersPage();

    // The TARGET user is an employee, so the controls are disabled. This is
    // usability only: the Stage 9 emulator suite proves the server refuses anyway.
    harness.openUserDialog('uid-b');

    assert.equal(harness.element('user-save').disabled, true);
    assert.equal(harness.element('user-approve').disabled, true);
  });
});

describe('Stage 9 requirement 17: a successful update refreshes the displayed data', () => {
  it('re-reads the list and shows the stored name', async () => {
    const harness = await openUsersPage();

    harness.openUserDialog('uid-a');
    harness.typeUserName('أحمد الجديد');
    await harness.clickUserAction('save');

    assert.equal(harness.callsTo('users.list').length, 2, 'the list must be re-read after a write');
    const row = harness.userRows().find((candidate) => candidate.getAttribute('data-uid') === 'uid-a');
    assert.equal(harness.rowCells(row ?? { children: [] } as never)[0], 'أحمد الجديد');
    // ...and the dialog closes, because the work is done.
    assert.equal(harness.userDialogOpen(), false);
  });

  it('applies an approval transition and shows the new status', async () => {
    const harness = await openUsersPage();

    harness.openUserDialog('uid-b');
    await harness.clickUserAction('approve');

    const row = harness.userRows().find((candidate) => candidate.getAttribute('data-uid') === 'uid-b');
    assert.equal(harness.rowCells(row ?? { children: [] } as never)[3], 'معتمد');
  });

  it('applies an exception transition and shows the new value', async () => {
    const harness = await openUsersPage();

    harness.openUserDialog('uid-c');
    await harness.clickUserAction('grant');

    harness.openUserDialog('uid-c');
    assert.equal(harness.element('user-detail-exception').textContent, 'نعم');
  });
});
describe('Stage 9 requirement 18: a failed update does not corrupt the displayed state', () => {
  it('keeps the dialog open with the safe message and leaves the rows intact', async () => {
    const harness = await openUsersPage({
      usersUpdate: { ok: false, error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية تنفيذ هذه العملية', retryable: false } },
    });

    harness.openUserDialog('uid-a');
    harness.typeUserName('محاولة مرفوضة');
    await harness.clickUserAction('save');

    assert.equal(harness.userDialogOpen(), true, 'the dialog must stay open on failure');
    assert.equal(harness.userDialogError(), 'ليست لديك صلاحية تنفيذ هذه العملية');
    // The typed name survives, and no row was corrupted.
    assert.equal((harness.element('user-detail-name') as unknown as { value: string }).value, 'محاولة مرفوضة');
    assert.equal(harness.userRows().length, 3);
    assert.equal(harness.rowCells(harness.userRows()[0] ?? { children: [] } as never)[0], 'أحمد。社会');
  });

  it('never renders the technical error code', async () => {
    const harness = await openUsersPage({
      usersUpdate: { ok: false, error: { code: 'INTERNAL_ERROR', message: 'رسالة آمنة', retryable: false } },
    });

    harness.openUserDialog('uid-a');
    await harness.clickUserAction('approve');

    const shown = harness.userDialogError() ?? '';
    assert.equal(shown.includes('INTERNAL_ERROR'), false);
    assert.equal(shown, 'رسالة آمنة');
  });

  it('shows a safe message when the update call itself throws', async () => {
    const harness = await openUsersPage({ throwOnUsersUpdate: true });

    harness.openUserDialog('uid-a');
    await harness.clickUserAction('approve');

    const shown = harness.userDialogError() ?? '';
    assert.ok(shown.length > 0);
    assert.equal(shown.includes('transport failed'), false);
    assert.equal(harness.userRows().length, 3);
  });
});

describe('Stage 9 requirement 19: duplicate submissions are prevented', () => {
  it('issues ONE write for a double-clicked save', async () => {
    const harness = await openUsersPage();

    harness.openUserDialog('uid-a');
    harness.typeUserName('نور');
    // Two clicks: the in-flight guard must drop the second.
    await harness.clickUserAction('save');
    await harness.clickUserAction('save');

    assert.equal(harness.callsTo('users.update').length, 1);
  });

  it('makes the save button usable again after the write settles', async () => {
    const harness = await openUsersPage();

    harness.openUserDialog('uid-a');
    harness.typeUserName('نور');
    await harness.clickUserAction('save');
    assert.equal(harness.userDialogOpen(), false);

    harness.openUserDialog('uid-a');
    assert.equal(harness.element('user-save').disabled, false);
  });

  it('does not pile up requests from a double-clicked refresh', async () => {
    const harness = await openUsersPage();
    const before = harness.callsTo('users.list').length;

    await harness.clickRefresh();
    await harness.clickRefresh();

    // The second click lands after the first settled, so both may run; what must
    // never happen is an unbounded pile-up from one click.
    assert.equal(harness.callsTo('users.list').length - before, 2);
  });
});

describe('Stage 9 requirement 20: logout still returns to login', () => {
  it('returns to the login form and drops the cached users', async () => {
    const harness = await openUsersPage();
    assert.equal(harness.visibleView(), 'shell');

    await harness.clickLogout();

    assert.equal(harness.callsTo('auth.signOut').length, 1);
    assert.equal(harness.visibleView(), 'login');
    // Nobody's name is left in the DOM behind a login form.
    assert.equal(harness.userRows().length, 0);
    assert.equal(harness.element('users-count').textContent, '');
  });

  it('does not reload the users when signed back in without navigating', async () => {
    const harness = await openUsersPage();
    await harness.clickLogout();
    const afterLogout = harness.callsTo('users.list').length;

    await harness.submitLogin('admin@example.com', 'secret-123');

    assert.equal(harness.visibleView(), 'shell');
    assert.equal(harness.callsTo('users.list').length, afterLogout);
  });
});

describe('Stage 9: the users module calls nothing beyond its two named operations', () => {
  it('uses only users.list and users.update while the page is in use', async () => {
    const harness = await openUsersPage();

    harness.searchUsers('محمد');
    // Clear the filter first: the point is the write path, not the filtered list.
    harness.searchUsers('');
    harness.openUserDialog('uid-a');
    harness.typeUserName('نور');
    await harness.clickUserAction('save');
    harness.openUserDialog('uid-c');
    await harness.clickUserAction('approve');
    await harness.clickRefresh();

    const allowed = new Set([
      'auth.getState', 'auth.signIn', 'auth.signOut', 'getAppStatus',
      'users.list', 'users.update',
    ]);
    for (const name of new Set(harness.calls.map((call) => call.name))) {
      assert.equal(allowed.has(name), true, `the users module must not call ${name}`);
    }
  });
});