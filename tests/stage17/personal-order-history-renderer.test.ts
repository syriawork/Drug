import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';

const EMPLOYEE: FakeSafeAuthState = {
  authenticated: true,
  uid: 'employee-a',
  email: 'employee@example.com',
  emailVerified: true,
  expirationTimeIso: null,
  role: 'employee',
};

function personalOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-a1',
    items: [
      { medicineName: 'دواء أول', quantity: 2 },
      { medicineName: 'دواء ثان', quantity: 1 },
    ],
    itemCount: 2,
    dateIso: '2026-09-20T10:00:00.000Z',
    monthYearDisplay: '09-2026',
    status: 'accepted',
    ...overrides,
  };
}

describe('Stage 17 personal order-history renderer', () => {
  it('calls only the named payload-free API and renders the returned personal data', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: { ok: true, orders: [personalOrder()] },
    });

    await harness.openMyOrderHistory();

    assert.equal(harness.element('my-orders-view').hidden, false);
    assert.deepEqual(harness.calls.filter((call) => call.name.startsWith('orders.')), [
      { name: 'orders.myHistory', args: [] },
    ]);
    assert.equal(harness.myOrderHistoryViewState(), 'ready');
    assert.deepEqual(harness.myOrderHistoryRowCells(harness.myOrderHistoryRows()[0]!), [
      'order-a1',
      '2026-09-20T10:00:00.000Z',
      '09-2026',
      'مقبول',
      '2',
      'دواء أول × 2، دواء ثان × 1',
    ]);
  });

  it('shows the loading state while the named read is in flight', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: { ok: true, orders: [personalOrder()] },
      ordersMyHistoryGate: gate,
    });

    const opening = harness.openMyOrderHistory();
    assert.equal(harness.myOrderHistoryViewState(), 'loading');
    release?.();
    await opening;
    assert.equal(harness.myOrderHistoryViewState(), 'ready');
  });

  it('renders a real empty state for an empty owner-scoped result', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: { ok: true, orders: [] },
    });

    await harness.openMyOrderHistory();

    assert.equal(harness.myOrderHistoryViewState(), 'empty');
    assert.equal(harness.myOrderHistoryRows().length, 0);
    assert.match(harness.element('my-orders-state-message').textContent, /لا توجد طلبات/);
  });

  it('shows safe application and transport errors without claiming an empty history', async () => {
    const rejected = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: false,
        error: { code: 'AUTHORIZATION_DENIED', message: 'رفض آمن', retryable: false },
      },
    });
    await rejected.openMyOrderHistory();
    assert.equal(rejected.myOrderHistoryViewState(), 'error');
    assert.equal(rejected.myOrderHistoryError(), 'رفض آمن');
    assert.equal(rejected.myOrderHistoryRows().length, 0);

    const transport = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      throwOnOrdersMyHistory: true,
    });
    await transport.openMyOrderHistory();
    assert.equal(transport.myOrderHistoryViewState(), 'error');
    assert.notEqual(transport.myOrderHistoryError(), '');
  });

  it('leaves manager-wide orders.list history independent', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersList: { ok: true, orders: [] },
      ordersMyHistory: { ok: true, orders: [personalOrder()] },
    });

    await harness.openOrdersHistory();
    assert.deepEqual(harness.calls.filter((call) => call.name.startsWith('orders.'))
      .map((call) => [call.name, call.args.length]), [['orders.list', 0]]);

    await harness.openMyOrderHistory();
    assert.deepEqual(harness.calls.filter((call) => call.name.startsWith('orders.'))
      .map((call) => [call.name, call.args.length]), [
        ['orders.list', 0],
        ['orders.myHistory', 0],
      ]);
    assert.equal(harness.orderHistoryRows().length, 0);
    assert.equal(harness.myOrderHistoryRows().length, 1);
  });
});
