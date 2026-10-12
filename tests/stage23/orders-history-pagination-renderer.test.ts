import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createRendererHarness,
  FakeEvent,
  type FakeBackendOptions,
  type FakeSafeAuthState,
} from '../stage8/helpers/renderer-harness';

const SIGNED_IN: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-12-31T23:59:59.000Z',
  role: 'admin',
};

const SECOND_SESSION: FakeSafeAuthState = {
  ...SIGNED_IN,
  uid: 'uid-next-session',
  email: 'next@example.com',
};

function row(id: string, status: string, medicineName = `Medicine ${id}`): Record<string, unknown> {
  return {
    id,
    userId: 'employee-1',
    employeeName: 'موظف',
    items: [{ medicineId: `med-${id}`, medicineName, quantity: 1 }],
    itemCount: 1,
    dateIso: '2026-10-11T09:00:00.000Z',
    monthYear: '10-2026',
    monthYearDisplay: '10-2026',
    status,
    isExceptionOrder: false,
    requestId: null,
  };
}

async function openHistory(
  firstPage: readonly unknown[],
  hasMore: boolean,
  laterPages: NonNullable<FakeBackendOptions['ordersLoadMoreSequence']>,
) {
  const harness = await createRendererHarness({
    stateOnStartup: SIGNED_IN,
    ordersList: { ok: true, orders: firstPage, hasMore },
    ordersLoadMoreSequence: laterPages,
  });
  await harness.openOrdersHistory();
  return harness;
}

function visibleIds(harness: Awaited<ReturnType<typeof createRendererHarness>>): string[] {
  return harness.orderHistoryRows().map((item) => item.getAttribute('data-order-id') ?? '');
}

describe('Stage 23 administrator history pagination in the renderer', () => {
  it('loads one next page, merges by order id, and keeps search and status filters local across pages', async () => {
    const harness = await openHistory(
      [row('order-1', 'pending'), row('order-2', 'accepted')],
      true,
      [{ ok: true, orders: [row('order-2', 'accepted'), row('order-3', 'pending', 'Special medicine')], hasMore: false }],
    );
    const readsBeforeFilters = harness.calls.filter((call) => call.name.startsWith('orders.')).length;

    harness.searchOrdersHistory('Special');
    harness.filterOrdersHistoryByStatus('pending');
    assert.deepEqual(visibleIds(harness), []);
    assert.equal(harness.calls.filter((call) => call.name.startsWith('orders.')).length, readsBeforeFilters);

    await harness.clickOrdersHistoryLoadMore();
    assert.deepEqual(visibleIds(harness), ['order-3']);
    assert.equal(harness.orderHistoryRows().length, 1);
    assert.match(harness.ordersHistoryCount(), /1 من 3 طلب محمّل/);
    assert.deepEqual(
      harness.calls.filter((call) => call.name.startsWith('orders.')).map((call) => [call.name, call.args.length]),
      [['orders.list', 0], ['orders.loadMore', 0]],
    );

    harness.searchOrdersHistory('order-2');
    assert.deepEqual(visibleIds(harness), []);
    assert.equal(harness.calls.filter((call) => call.name.startsWith('orders.')).length, 2);
  });

  it('refresh replaces the loaded window and resets the Load More lifecycle', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      ordersListSequence: [
        { ok: true, orders: [row('old-order', 'pending')], hasMore: true },
        { ok: true, orders: [row('fresh-order', 'accepted')], hasMore: false },
      ],
      ordersLoadMoreSequence: [{ ok: true, orders: [row('stale-next', 'pending')], hasMore: false }],
    });
    await harness.openOrdersHistory();
    harness.searchOrdersHistory('fresh');
    harness.filterOrdersHistoryByStatus('accepted');
    await harness.clickOrdersHistoryRefresh();

    assert.deepEqual(visibleIds(harness), ['fresh-order']);
    assert.equal(harness.element('orders-history-load-more').hidden, true);
    assert.deepEqual(
      harness.calls.filter((call) => call.name === 'orders.list').map((call) => call.args),
      [[], []],
    );
  });

  it('preserves loaded rows after a failed page and safely retries the same Load More action', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      ordersList: { ok: true, orders: [row('order-1', 'pending')], hasMore: true },
      ordersLoadMoreSequence: [
        { ok: false, error: { code: 'INFRASTRUCTURE_FAILURE', message: 'تعذر تحميل الصفحة', retryable: true } },
        { ok: true, orders: [row('order-2', 'accepted')], hasMore: false },
      ],
    });
    await harness.openOrdersHistory();
    await harness.clickOrdersHistoryLoadMore();

    assert.deepEqual(visibleIds(harness), ['order-1']);
    assert.equal(harness.element('orders-history-load-more-state').textContent, 'تعذر تحميل الصفحة');
    assert.equal(harness.element('orders-history-load-more').disabled, false);

    await harness.clickOrdersHistoryLoadMore();
    assert.deepEqual(visibleIds(harness), ['order-1', 'order-2']);
    assert.equal(harness.element('orders-history-load-more').hidden, true);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.loadMore').length, 2);
  });

  it('derives initial loaded state from active filters when the first load completes', async () => {
    let releaseLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      ordersList: { ok: true, orders: [row('order-1', 'accepted')], hasMore: false },
      ordersListGate: loadGate,
    });
    const historyNav = harness.document.querySelectorAll('[data-view]')
      .find((candidate) => candidate.getAttribute('data-view') === 'orders-history');
    assert.notEqual(historyNav, undefined);
    historyNav!.dispatchEvent(new FakeEvent('click'));
    harness.filterOrdersHistoryByStatus('pending');
    assert.equal(harness.ordersHistoryViewState(), 'loading');
    releaseLoad?.();
    await harness.settle();

    assert.deepEqual(visibleIds(harness), []);
    assert.equal(harness.ordersHistoryViewState(), 'empty');
    assert.match(harness.element('orders-history-state-message').textContent, /مطابقة.*محمّلة/);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 1);
  });

  it('discards first-page responses from a signed-out session without disturbing a new session load', async () => {
    let releaseOldLoad: (() => void) | undefined;
    let releaseNewLoad: (() => void) | undefined;
    const oldLoad = new Promise<void>((resolve) => {
      releaseOldLoad = resolve;
    });
    const newLoad = new Promise<void>((resolve) => {
      releaseNewLoad = resolve;
    });
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      stateAfterSignIn: SECOND_SESSION,
      ordersListSequence: [
        { ok: true, orders: [row('stale-first-page', 'pending')], hasMore: false },
        { ok: true, orders: [row('current-session-page', 'accepted')], hasMore: false },
      ],
      ordersListGateSequence: [oldLoad, newLoad],
    });

    harness.clickNav('orders-history');
    await harness.clickLogout();
    await harness.submitLogin('next@example.com', 'password');
    harness.clickNav('orders-history');

    releaseOldLoad?.();
    await harness.settle();
    assert.deepEqual(visibleIds(harness), []);
    assert.equal(harness.ordersHistoryViewState(), 'loading');

    releaseNewLoad?.();
    await harness.settle();
    assert.deepEqual(visibleIds(harness), ['current-session-page']);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 2);
  });

  it('discards a Load More response after sign-out and loads the new session history afresh', async () => {
    let releaseLoadMore: (() => void) | undefined;
    const loadMoreGate = new Promise<void>((resolve) => {
      releaseLoadMore = resolve;
    });
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      stateAfterSignIn: SECOND_SESSION,
      ordersListSequence: [
        { ok: true, orders: [row('old-session-first-page', 'pending')], hasMore: true },
        { ok: true, orders: [row('new-session-first-page', 'accepted')], hasMore: false },
      ],
      ordersLoadMoreSequence: [
        { ok: true, orders: [row('stale-load-more-page', 'pending')], hasMore: false },
      ],
      ordersLoadMoreGateSequence: [loadMoreGate],
    });

    await harness.openOrdersHistory();
    harness.element('orders-history-load-more').dispatchEvent(new FakeEvent('click'));
    await harness.clickLogout();
    releaseLoadMore?.();
    await harness.settle();
    assert.deepEqual(visibleIds(harness), []);

    await harness.submitLogin('next@example.com', 'password');
    harness.clickNav('orders-history');
    await harness.settle();

    assert.deepEqual(visibleIds(harness), ['new-session-first-page']);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 2);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.loadMore').length, 1);
  });

  it('keeps load and refresh errors visible when search and status controls change', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      ordersListSequence: [
        { ok: true, orders: [row('loaded-order', 'pending')], hasMore: false },
        { ok: false, error: { code: 'INFRASTRUCTURE_FAILURE', message: 'تعذر تحديث السجل', retryable: true } },
      ],
    });
    await harness.openOrdersHistory();
    await harness.clickOrdersHistoryRefresh();

    assert.equal(harness.ordersHistoryViewState(), 'error');
    assert.deepEqual(visibleIds(harness), ['loaded-order']);
    harness.searchOrdersHistory('missing');
    harness.filterOrdersHistoryByStatus('accepted');

    assert.equal(harness.ordersHistoryViewState(), 'error');
    assert.equal(harness.element('orders-history-state-message').textContent, 'تعذر تحديث السجل');
    assert.deepEqual(visibleIds(harness), []);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 2);
  });

  it('does not trigger data reads when filters change or when printing the loaded, filtered rows', async () => {
    const harness = await openHistory(
      [row('order-1', 'pending'), row('order-2', 'accepted')],
      true,
      [],
    );
    harness.filterOrdersHistoryByStatus('accepted');
    harness.searchOrdersHistory('Medicine order-2');
    const beforePrint = harness.calls.filter((call) => call.name.startsWith('orders.')).length;
    harness.clickOrdersHistoryPrint();

    assert.deepEqual(visibleIds(harness), ['order-2']);
    assert.equal(harness.calls.filter((call) => call.name.startsWith('orders.')).length, beforePrint);
    assert.equal(harness.element('orders-history-report-count').textContent, 'عدد النتائج المعروضة: 1');
    assert.equal(harness.element('orders-history-report-scope').textContent.includes('المحمّلة والمصفّاة محليًا حاليًا'), true);
    assert.equal(harness.element('orders-history-report-scope').textContent.includes('لا يُضمن الترتيب الزمني'), true);
    assert.equal(harness.element('orders-history-report-scope').textContent.includes('اتساق اللقطة'), true);
  });

  it('prints an explicit empty result state without loading another page', async () => {
    const harness = await openHistory(
      [row('order-1', 'pending')],
      true,
      [],
    );
    harness.searchOrdersHistory('not-present');
    const beforePrint = harness.calls.filter((call) => call.name.startsWith('orders.')).length;
    harness.clickOrdersHistoryPrint();

    assert.deepEqual(visibleIds(harness), []);
    assert.equal(harness.element('orders-history-report-empty').hidden, false);
    assert.equal(harness.element('orders-history-report-count').textContent, 'عدد النتائج المعروضة: 0');
    assert.equal(harness.calls.filter((call) => call.name.startsWith('orders.')).length, beforePrint);
  });
});
