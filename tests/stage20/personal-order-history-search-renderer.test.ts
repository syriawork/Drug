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

describe('Stage 20 personal order-history search and status filters', () => {
  it('searches by order id inside the currently loaded window only', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [
          personalOrder({ id: 'order-100', status: 'accepted' }),
          personalOrder({ id: 'order-200', status: 'rejected', itemCount: 1, items: [{ medicineName: 'دواء آخر', quantity: 3 }] }),
        ],
      },
    });

    await harness.openMyOrderHistory();
    harness.searchMyOrderHistory('200');

    assert.equal(harness.myOrderHistoryRows().length, 1);
    assert.deepEqual(harness.myOrderHistoryRowCells(harness.myOrderHistoryRows()[0]!), [
      'order-200',
      '2026-09-20T10:00:00.000Z',
      '09-2026',
      'مرفوض',
      '1',
      'دواء آخر × 3',
    ]);
  });

  it('searches by medicine name without a backend call', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [
          personalOrder({ id: 'order-101', items: [{ medicineName: 'بانادول', quantity: 2 }] }),
          personalOrder({ id: 'order-202', items: [{ medicineName: 'أمبيكس', quantity: 1 }] }),
        ],
      },
    });

    await harness.openMyOrderHistory();
    harness.searchMyOrderHistory('بانادول');

    assert.equal(harness.myOrderHistoryRows().length, 1);
    assert.equal(harness.myOrderHistoryRowCells(harness.myOrderHistoryRows()[0]!)[0], 'order-101');
    assert.deepEqual(harness.calls.filter((call) => call.name.startsWith('orders.')).map((call) => call.name), ['orders.myHistory']);
  });

  it('filters by status using only the stored statuses already shown in the page', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [
          personalOrder({ id: 'order-300', status: 'accepted' }),
          personalOrder({ id: 'order-301', status: 'pending' }),
          personalOrder({ id: 'order-302', status: 'rejected' }),
        ],
      },
    });

    await harness.openMyOrderHistory();
    harness.filterMyOrderHistoryByStatus('accepted');

    assert.equal(harness.myOrderHistoryRows().length, 1);
    assert.deepEqual(harness.myOrderHistoryRowCells(harness.myOrderHistoryRows()[0]!), [
      'order-300',
      '2026-09-20T10:00:00.000Z',
      '09-2026',
      'مقبول',
      '2',
      'دواء أول × 2، دواء ثان × 1',
    ]);
  });

  it('combines search and status filters locally', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [
          personalOrder({ id: 'order-400', status: 'accepted', items: [{ medicineName: 'دواء أول', quantity: 2 }] }),
          personalOrder({ id: 'order-401', status: 'accepted', items: [{ medicineName: 'دواء آخر', quantity: 5 }] }),
          personalOrder({ id: 'order-402', status: 'rejected', items: [{ medicineName: 'دواء أول', quantity: 3 }] }),
        ],
      },
    });

    await harness.openMyOrderHistory();
    harness.filterMyOrderHistoryByStatus('accepted');
    harness.searchMyOrderHistory('دواء أول');

    assert.equal(harness.myOrderHistoryRows().length, 1);
    assert.equal(harness.myOrderHistoryRowCells(harness.myOrderHistoryRows()[0]!)[0], 'order-400');
  });

  it('clears filters and restores the loaded result set', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [
          personalOrder({ id: 'order-500', status: 'accepted' }),
          personalOrder({ id: 'order-501', status: 'rejected' }),
        ],
      },
    });

    await harness.openMyOrderHistory();
    harness.filterMyOrderHistoryByStatus('rejected');
    harness.searchMyOrderHistory('500');
    harness.clearMyOrderHistoryFilters();

    assert.equal(harness.myOrderHistoryRows().length, 2);
    assert.equal(harness.myOrderHistoryCount(), 'عدد الطلبات في هذه النافذة: 2');
  });

  it('renders a clear empty state after filter mismatch, without implying the order is absent outside the loaded window', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [
          personalOrder({ id: 'order-600', status: 'accepted' }),
        ],
      },
    });

    await harness.openMyOrderHistory();
    harness.searchMyOrderHistory('مستحيل');

    assert.equal(harness.myOrderHistoryViewState(), 'empty');
    assert.equal(harness.myOrderHistoryRows().length, 0);
    assert.equal(harness.myOrderHistoryError(), null);
    assert.match(harness.element('my-orders-state-message').textContent, /لا توجد طلبات مطابقة/);

    harness.clearMyOrderHistoryFilters();

    assert.equal(harness.myOrderHistoryViewState(), 'ready');
    assert.equal(harness.myOrderHistoryRows().length, 1);
  });

  it('keeps the filtered empty state after a successful refresh', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [personalOrder({ id: 'order-700' })],
      },
    });

    await harness.openMyOrderHistory();
    harness.searchMyOrderHistory('مستحيل');
    await harness.clickMyOrderHistoryRefresh();

    assert.equal(harness.myOrderHistoryViewState(), 'empty');
    assert.equal(harness.myOrderHistoryRows().length, 0);
    assert.match(harness.element('my-orders-state-message').textContent, /لا توجد طلبات مطابقة/);
  });

  it('derives the filtered empty state when the initial load completes with filters active', async () => {
    let releaseHistoryRead!: () => void;
    const historyReadGate = new Promise<void>((resolve) => {
      releaseHistoryRead = resolve;
    });
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistoryGate: historyReadGate,
      ordersMyHistory: {
        ok: true,
        orders: [personalOrder({ id: 'order-800' })],
      },
    });

    await harness.openMyOrderHistory();
    assert.equal(harness.myOrderHistoryViewState(), 'loading');
    harness.searchMyOrderHistory('مستحيل');
    assert.equal(harness.myOrderHistoryViewState(), 'loading');

    releaseHistoryRead();
    await harness.clickMyOrderHistoryRefresh();

    assert.equal(harness.myOrderHistoryViewState(), 'empty');
    assert.equal(harness.myOrderHistoryRows().length, 0);
    assert.match(harness.element('my-orders-state-message').textContent, /لا توجد طلبات مطابقة/);
  });
});
