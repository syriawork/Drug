/**
 * Stage 8 - the login and shell flow, exercised against the REAL bundle.
 *
 * These tests run `dist/renderer/renderer.js` in a `node:vm` sandbox whose DOM is
 * built from the shipped `index.html`, then drive the shell the way a person
 * does: fill the form, submit, click a navigation entry, sign out.
 *
 * What that buys over reading the source: these assertions are about BEHAVIOUR.
 * A renderer that quietly called a data operation on start-up, or that sent more
 * than two fields to the bridge, would pass every source-text check and fail
 * here.
 *
 * The sandbox contains no `require`, no `process` and no filesystem, so a bundle
 * that reached for a Node API would fail to even load.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SIGNED_OUT, createRendererHarness, type FakeSafeAuthState } from './helpers/renderer-harness';

/** A signed-in state carrying a display name and an advisory role. */
const SIGNED_IN: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-10-01T09:00:00.000Z',
  displayName: 'Nour',
  role: 'admin',
};

describe('Stage 8: the login screen exists and is the start-up view', () => {
  it('shows the login form when nobody is signed in', async () => {
    const harness = await createRendererHarness();

    assert.equal(harness.visibleView(), 'login');
    assert.equal(harness.element('login-form').hidden, false);
    assert.equal(harness.uiState(), 'unauthenticated');
    // The shell exists in the markup but stays hidden until a real session.
    assert.equal(harness.element('shell-view').hidden, true);
  });

  it('asks the Stage 7 authentication API for the safe state at start-up', async () => {
    const harness = await createRendererHarness();

    // Not a guess and not a local decision: the renderer asks, and the answer
    // decides which view opens.
    assert.equal(harness.callsTo('auth.getState').length, 1);
  });

  it('renders no error before the user has done anything', async () => {
    const harness = await createRendererHarness();

    assert.equal(harness.element('login-error').hidden, true);
    assert.equal(harness.element('login-error-message').textContent, '');
  });
});

describe('Stage 8 requirement 9 & 10: start-up honours the safe state', () => {
  it('stays on login for an unauthenticated start-up', async () => {
    const harness = await createRendererHarness();

    assert.equal(harness.visibleView(), 'login');
    assert.equal(harness.callsTo('auth.signIn').length, 0);
  });

  it('goes straight to the manager shell when the safe state says so', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN });

    assert.equal(harness.visibleView(), 'shell');
    assert.equal(harness.uiState(), 'authenticated');
    assert.equal(harness.element('login-view').hidden, true);
    assert.equal(harness.callsTo('auth.signIn').length, 0);
  });

  it('shows the signed-in user from the safe authentication state', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN });

    assert.equal(harness.element('shell-user-name').textContent, 'Nour');
    assert.equal(harness.element('shell-user-email').textContent, 'admin@example.com');
    assert.equal(harness.element('dashboard-user-name').textContent, 'Nour');
    assert.equal(harness.element('dashboard-user-email').textContent, 'admin@example.com');
  });

  it('labels the advisory role in Arabic and gates nothing on it', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN });

    assert.equal(harness.element('shell-user-role').textContent, 'مدير النظام');

    // Every navigation entry is present regardless of the role. The renderer
    // displays the role; it never decides with it. Stage 16 adds employee
    // submission, and Stage 17 adds the employee's own order history.
    const navButtons = harness.document.querySelectorAll('[data-view]');
    assert.deepEqual(
      navButtons.map((button) => button.getAttribute('data-view')),
      ['dashboard', 'users', 'medicines', 'orders', 'request-submit', 'orders-history', 'my-orders', 'stock', 'settings'],
    );
    for (const button of navButtons) {
      assert.equal(button.hidden, false);
      assert.equal(button.disabled, false);
    }
  });
describe('Stage 8 requirement 5: login sends only email and password', () => {
  it('submits exactly two fields and nothing else', async () => {
    const harness = await createRendererHarness();

    await harness.submitLogin('admin@example.com', 'secret-123');

    const signInCalls = harness.callsTo('auth.signIn');
    assert.equal(signInCalls.length, 1);
    const payload = signInCalls[0]?.args[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ['email', 'password']);
    assert.equal(payload['email'], 'admin@example.com');
    assert.equal(payload['password'], 'secret-123');
  });

  it('sends no role, no uid and no token with the credentials', async () => {
    const harness = await createRendererHarness();

    await harness.submitLogin('admin@example.com', 'secret-123');

    const payload = harness.callsTo('auth.signIn')[0]?.args[0] as Record<string, unknown>;
    for (const forbidden of ['role', 'uid', 'token', 'idToken', 'refreshToken', 'displayName']) {
      assert.equal(forbidden in payload, false, `the login payload must not carry ${forbidden}`);
    }
  });

  it('refuses an empty submission without calling the bridge', async () => {
    const harness = await createRendererHarness();

    await harness.submitLogin('   ', '');

    assert.equal(harness.callsTo('auth.signIn').length, 0);
    assert.equal(harness.visibleView(), 'login');
    assert.ok(harness.element('login-error-message').textContent.length > 0);
  });
});

describe('Stage 8 requirement 6: a successful sign-in enters the shell', () => {
  it('transitions to the authenticated view and shows the identity', async () => {
    const harness = await createRendererHarness();

    await harness.submitLogin('admin@example.com', 'secret-123');

    assert.equal(harness.visibleView(), 'shell');
    assert.equal(harness.uiState(), 'authenticated');
    assert.equal(harness.element('shell-user-name').textContent, 'Nour');
  });

  it('re-reads the safe state after signing in', async () => {
    const harness = await createRendererHarness();

    await harness.submitLogin('admin@example.com', 'secret-123');

    // The shell renders the state the Main process currently considers
    // authoritative, not merely the optimistic sign-in result.
    assert.ok(harness.callsTo('auth.getState').length >= 2);
  });

  it('clears the password from the DOM after a successful sign-in', async () => {
    const harness = await createRendererHarness();

    await harness.submitLogin('admin@example.com', 'secret-123');

    assert.equal((harness.element('login-password') as unknown as { value: string }).value, '');
  });
});
describe('Stage 8 requirement 7: a failed sign-in shows only the safe message', () => {
  it('stays on login and displays the Arabic message from Stage 7', async () => {
    const harness = await createRendererHarness({
      signInResult: {
        success: false,
        authState: SIGNED_OUT,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
      },
    });

    await harness.submitLogin('admin@example.com', 'wrong');

    assert.equal(harness.visibleView(), 'login');
    assert.equal(harness.uiState(), 'unauthenticated');
    assert.equal(harness.element('login-error').hidden, false);
    assert.equal(
      harness.element('login-error-message').textContent,
      'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    );
  });

  it('never renders the technical error code', async () => {
    const harness = await createRendererHarness({
      signInResult: {
        success: false,
        authState: SIGNED_OUT,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'رسالة آمنة' },
      },
    });

    await harness.submitLogin('admin@example.com', 'wrong');

    // The code exists for logs. Putting it in front of a user would be both
    // useless to them and a small information leak.
    assert.equal(harness.element('login-error-message').textContent.includes('AUTH_INVALID_CREDENTIALS'), false);
  });

  it('discards the password after a failure', async () => {
    const harness = await createRendererHarness({
      signInResult: { success: false, authState: SIGNED_OUT, error: { code: 'X', message: 'فشل' } },
    });

    await harness.submitLogin('admin@example.com', 'wrong');

    assert.equal((harness.element('login-password') as unknown as { value: string }).value, '');
  });

  it('shows a safe message when the bridge call itself fails', async () => {
    const harness = await createRendererHarness({ throwOnSignIn: true });

    await harness.submitLogin('admin@example.com', 'secret-123');

    assert.equal(harness.visibleView(), 'login');
    // The internal failure text must not reach the screen.
    const shown = harness.element('login-error-message').textContent;
    assert.ok(shown.length > 0);
    assert.equal(shown.includes('transport failed'), false);
  });

  it('clears a previous error when the next attempt starts', async () => {
    const harness = await createRendererHarness();

    // A client-side refusal raises the error region without touching the bridge.
    await harness.submitLogin('   ', '');
    assert.equal(harness.element('login-error').hidden, false);

    // A real attempt clears it, so a stale message never sits above a fresh form.
    await harness.submitLogin('admin@example.com', 'secret-123');
    assert.equal(harness.element('login-error').hidden, true);
    assert.equal(harness.element('login-error-message').textContent, '');
  });
});

describe('Stage 8 requirement 8: logout returns to the login screen', () => {
  it('calls the Stage 7 sign-out and clears the renderer state', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN });
    assert.equal(harness.visibleView(), 'shell');

    await harness.clickLogout();

    assert.equal(harness.callsTo('auth.signOut').length, 1);
    assert.equal(harness.visibleView(), 'login');
    assert.equal(harness.uiState(), 'unauthenticated');
  });

  it('leaves no identity on screen after signing out', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN });

    await harness.clickLogout();

    // A stale name left on screen is a real leak on a shared machine.
    assert.equal(harness.element('shell-user-name').textContent, '');
    assert.equal(harness.element('shell-user-email').textContent, '');
    assert.equal(harness.element('shell-user-role').textContent, '');
    assert.equal(harness.element('dashboard-user-name').textContent, '');
    assert.equal(harness.element('dashboard-user-email').textContent, '');
  });

  it('returns to login even when the sign-out call fails', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN, throwOnSignOut: true });

    await harness.clickLogout();

    assert.equal(harness.visibleView(), 'login');
  });
});
describe('Stage 8 requirement 12: navigation reaches only working screens', () => {
  it('renders no navigation at all while signed out', async () => {
    // The Stage 8 claim that still stands, and it is the STRONGEST form of it.
    // Later stages each took one entry away from the placeholder list - Stage 9
    // `users`, Stage 10 `medicines`, Stage 11 `orders`, Stage 13 `settings` and
    // Stage 14 `stock` - so there is no longer any placeholder entry to exercise
    // here.
    //
    // What replaces it: the shell itself is absent. There is no navigation to
    // click and no panel to open, so no page read can be triggered at all - which
    // is a stronger guarantee than counting calls, because it cannot be bypassed
    // by a click a person could not physically make.
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_OUT });

    assert.equal(harness.visibleView(), 'login');
    assert.equal(harness.element('login-view').hidden, false);
    assert.equal(harness.element('shell-view').hidden, true);
  });

  it('opens every page as a real panel and marks the active entry', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN });

    harness.clickNav('stock');
    // Stage 14 turned the last placeholder into a real screen, so it is no longer
    // the placeholder panel - and the placeholder notice is never shown now.
    assert.equal(harness.element('stock-view').hidden, false);
    assert.equal(harness.element('placeholder-view').hidden, true);
    assert.equal(harness.element('dashboard-view').hidden, true);
    assert.equal(harness.element('users-view').hidden, true);
    assert.equal(harness.element('medicines-view').hidden, true);
    assert.equal(harness.element('orders-view').hidden, true);
    assert.equal(harness.element('orders-history-view').hidden, true);
    assert.equal(harness.element('settings-view').hidden, true);

    // And exactly one navigation entry is marked active.
    const active = harness.document.querySelectorAll('[data-view]')
      .filter((button) => button.getAttribute('aria-current') === 'page');
    assert.equal(active.length, 1, 'exactly one navigation entry may be marked active');
    assert.equal(active[0]?.getAttribute('data-view'), 'stock');

    // The Arabic LABEL is checked in the shipped markup rather than on the fake
    // element: `buildDocument` only instantiates elements carrying an id, so the
    // `<span class="nav-item-text">` inside the button does not exist in the fake
    // tree and reading the button's `textContent` there would report an empty
    // string for a label that is plainly on screen in a browser.
    const html = readFileSync(join(__dirname, '..', '..', '..', 'src', 'renderer', 'index.html'), 'utf8');
    const entryStart = html.indexOf('data-view="stock"');
    assert.ok(entryStart >= 0, 'the shipped markup declares no stock navigation entry');
    const entry = html.slice(entryStart, html.indexOf('</button>', entryStart));
    assert.ok(entry.includes('سجل حركة المخزون'), 'the stock entry must carry its Arabic label');
    // And it carries no "coming soon" tag any more.
    assert.equal(entry.includes('nav-item-tag'), false);
  });

  it('returns to the dashboard without any further calls', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN });

    harness.clickNav('users');
    const before = harness.calls.length;
    harness.clickNav('dashboard');

    assert.equal(harness.calls.length, before);
    assert.equal(harness.element('dashboard-view').hidden, false);
    assert.equal(harness.element('placeholder-view').hidden, true);
  });
});

describe('Stage 8: the password control', () => {
  it('toggles visibility and reports its state to assistive technology', async () => {
    const harness = await createRendererHarness();
    const password = harness.element('login-password') as unknown as { type: string };
    const toggle = harness.element('password-toggle');

    assert.equal(password.type, 'password');
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');

    harness.clickPasswordToggle();
    assert.equal(password.type, 'text');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');

    harness.clickPasswordToggle();
    assert.equal(password.type, 'password');
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  });

  it('is reset to masked after a successful sign-in', async () => {
    const harness = await createRendererHarness();

    harness.clickPasswordToggle();
    await harness.submitLogin('admin@example.com', 'secret-123');

    assert.equal((harness.element('login-password') as unknown as { type: string }).type, 'password');
  });
});

describe('Stage 8: the renderer calls only the named Stage 7 API', () => {
  it('uses nothing beyond the authentication and status operations', async () => {
    const harness = await createRendererHarness();

    await harness.submitLogin('admin@example.com', 'secret-123');
    await harness.clickLogout();

    const allowed = new Set(['auth.getState', 'auth.signIn', 'auth.signOut', 'getAppStatus']);
    const used = new Set(harness.calls.map((call) => call.name));
    for (const name of used) {
      assert.equal(allowed.has(name), true, `the renderer must not call ${name}`);
    }
  });

  it('renders the process status from the Stage 7 status payload', async () => {
    const harness = await createRendererHarness({ stateOnStartup: SIGNED_IN });

    assert.equal(harness.callsTo('getAppStatus').length, 1);
    assert.equal(harness.element('status-value').textContent, 'حالة التطبيق: يعمل');
    // The status block is populated even on the login screen, because it
    // describes the process rather than the session.
    assert.ok(harness.element('info-list').children.length > 0);
  });
});
});
