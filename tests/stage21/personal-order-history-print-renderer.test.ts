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

function personalOrder(
  id: string,
  status: 'pending' | 'accepted' | 'rejected',
  medicineName: string,
): Record<string, unknown> {
  return {
    id,
    items: [{ medicineName, quantity: 2 }],
    itemCount: 1,
    dateIso: '2026-09-20T10:00:00.000Z',
    monthYearDisplay: '09-2026',
    status,
  };
}

describe('Stage 21 personal order-history print report', () => {
  it('prints only filtered rows with report metadata and no additional backend reads', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [
          personalOrder('order-print-1', 'accepted', 'بانادول'),
          personalOrder('order-print-2', 'rejected', 'أمبيكس'),
        ],
      },
    });

    await harness.openMyOrderHistory();
    harness.filterMyOrderHistoryByStatus('accepted');
    harness.searchMyOrderHistory('بانادول');
    const callsBeforePrint = harness.calls.length;

    harness.clickMyOrderHistoryPrint();

    assert.equal(harness.printCalls(), 1);
    assert.equal(harness.calls.length, callsBeforePrint);
    assert.deepEqual(harness.myOrderHistoryRows().map((row) => harness.myOrderHistoryRowCells(row)), [[
      'order-print-1',
      '2026-09-20T10:00:00.000Z',
      '09-2026',
      'مقبول',
      '1',
      'بانادول × 2',
    ]]);
    assert.equal(harness.element('my-orders-report-title').textContent, 'تقرير طلباتي المنفَّذة');
    assert.equal(harness.element('my-orders-report-filters').textContent, 'البحث: بانادول؛ الحالة: مقبول');
    assert.equal(harness.element('my-orders-report-count').textContent, 'عدد النتائج المعروضة: 1');
    assert.notEqual(harness.element('my-orders-report-generated-at').textContent, '');
    assert.match(harness.element('my-orders-report-generated-at').textContent, /تاريخ ووقت إنشاء التقرير/);
    assert.match(harness.element('my-orders-report-empty').textContent, /لا توجد طلبات تطابق/);
  });

  it('prints an empty result count and discloses the bounded, potentially unsorted history window', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: EMPLOYEE,
      ordersMyHistory: {
        ok: true,
        orders: [personalOrder('order-print-3', 'pending', 'دواء')],
      },
    });

    await harness.openMyOrderHistory();
    harness.searchMyOrderHistory('غير موجود');
    harness.clickMyOrderHistoryPrint();

    assert.equal(harness.printCalls(), 1);
    assert.equal(harness.myOrderHistoryRows().length, 0);
    assert.equal(harness.element('my-orders-report-count').textContent, 'عدد النتائج المعروضة: 0');
    assert.equal(harness.element('my-orders-report-empty').hidden, false);
    assert.match(harness.element('my-orders-report-empty').textContent, /لا توجد طلبات تطابق عوامل التصفية/);
    assert.match(harness.element('my-orders-report-filters').textContent, /البحث: غير موجود/);
    assert.match(harness.element('my-orders-report-scope').textContent, /نافذة السجل المحدودة المحمّلة حاليًا، ولا يضمن ترتيبًا زمنيًا/);
    assert.deepEqual(harness.calls.filter((call) => call.name === 'orders.myHistory').map((call) => call.name), [
      'orders.myHistory',
    ]);
  });
});
