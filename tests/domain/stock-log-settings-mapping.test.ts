import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MalformedDataError } from '../../electron/domain/errors';
import { mapOrderRequest } from '../../electron/repositories/firestore/mappers/order-request-mapper';
import { mapStockLog, mapAppSettings } from '../../electron/repositories/firestore/mappers/order-mapper';
import { FirestoreTimestamp } from '../../electron/services/firestore-codec';

/** Stage 5B mapping tests - stock logs (G), settings (H), optional fields (J). */

const ts = (iso: string): FirestoreTimestamp => FirestoreTimestamp.parse(iso);
const DATE = '2026-06-03T08:00:00.000Z';

describe('Stage 5B/G: stock log mapping', () => {
  it('renames userName to label and uid to actorUid (D3, D10)', () => {
    const log = mapStockLog('l1', {
      uid: 'admin1', medicineId: 'm1', medicineName: 'x', quantity: 5, type: 'inward',
      date: ts(DATE),
      // Real A4 free text, not a username.
      userName: 'ØªØ¹Ø¯ÙŠÙ„ ÙƒÙ…ÙŠØ© ÙÙŠ Ø·Ù„Ø¨: ØµÙŠØ¯Ù„Ø§Ù†ÙŠ (Ù…Ù† 3 Ø¥Ù„Ù‰ 5)',
    }, 'stock_logs/l1');

    assert.equal(log.label, 'ØªØ¹Ø¯ÙŠÙ„ ÙƒÙ…ÙŠØ© ÙÙŠ Ø·Ù„Ø¨: ØµÙŠØ¯Ù„Ø§Ù†ÙŠ (Ù…Ù† 3 Ø¥Ù„Ù‰ 5)');
    assert.equal(log.actorUid, 'admin1');
  });

  it('maps the A2 flavour, where userName is the employee name', () => {
    const log = mapStockLog('l2', {
      uid: 'employee1', medicineId: 'm1', medicineName: 'x', quantity: 2, type: 'outward',
      date: ts(DATE), userName: 'ØµÙŠØ¯Ù„Ø§Ù†ÙŠ Ø£ÙˆÙ„', requestId: 'r1', orderId: 'o1',
    }, 'stock_logs/l2');

    assert.equal(log.type, 'outward');
    assert.equal(log.label, 'ØµÙŠØ¯Ù„Ø§Ù†ÙŠ Ø£ÙˆÙ„');
    assert.equal(log.actorUid, 'employee1');
    assert.equal(log.requestId, 'r1');
    assert.equal(log.orderId, 'o1');
  });

  it('reports an unknown movement type and falls back to inward', () => {
    const seen: string[] = [];
    const log = mapStockLog('l1', {
      medicineId: 'm1', quantity: 1, type: 'transfer', date: ts(DATE),
    }, 'stock_logs/l1', (actual) => seen.push(actual));
    assert.equal(log.type, 'inward');
    assert.deepEqual(seen, ['transfer']);
  });

  it('requires medicineId, quantity and date', () => {
    assert.throws(() => mapStockLog('l', { quantity: 1, type: 'inward', date: ts(DATE) }, 'stock_logs/l'), MalformedDataError);
    assert.throws(() => mapStockLog('l', { medicineId: 'm', type: 'inward', date: ts(DATE) }, 'stock_logs/l'), MalformedDataError);
  });
});

describe('Stage 5B/H: settings mapping', () => {
  it('maps a complete settings/app document', () => {
    const settings = mapAppSettings({
      minDaysBetweenOrders: 20, maxDailyOrders: 50, allowFridayOrders: true,
      startTime: '08:00', endTime: '20:00', assistantId: 'EMP-001',
    });
    assert.equal(settings.minDaysBetweenOrders, 20);
    assert.equal(settings.allowFridayOrders, true);
    assert.equal(settings.startTime, '08:00');
    assert.equal(settings.endTime, '20:00');
    assert.equal(settings.assistantId, 'EMP-001');
    assert.equal(settings.maxDailyOrders, 50);
  });

  it('uses the SAME fallbacks as the Android engine (A2 lines 259-262)', () => {
    const settings = mapAppSettings({});
    assert.equal(settings.minDaysBetweenOrders, 15);
    assert.equal(settings.allowFridayOrders, false);
    assert.equal(settings.startTime, '06:00');
    assert.equal(settings.endTime, '10:00');
    assert.equal(settings.maxDailyOrders, 50);
    assert.equal(settings.assistantId, '');
  });

  it('never treats a non-boolean value as an enabled flag', () => {
    assert.equal(mapAppSettings({ allowFridayOrders: 'yes' as unknown as boolean }).allowFridayOrders, false);
  });
});

describe('Stage 5B/J: missing optional fields', () => {
  it('maps item lines without a medicineName snapshot', () => {
    const request = mapOrderRequest('r', {
      uid: 'u', items: [{ medicineId: 'm1', quantity: 1 }], status: 'pending', requestDate: ts(DATE),
    }, 'order_requests/r');
    assert.equal(request.items[0]?.medicineName, '');
  });

  it('rejects a malformed item line with its exact index', () => {
    assert.throws(
      () => mapOrderRequest('r', {
        uid: 'u', items: [{ medicineId: 'm1', quantity: 1 }, { medicineId: 'm2' }],
        status: 'pending', requestDate: ts(DATE),
      }, 'order_requests/r'),
      (error: unknown) => error instanceof MalformedDataError && error.fieldPath === 'items[1].quantity',
    );
  });

  it('rejects items that are not an array at all', () => {
    assert.throws(
      () => mapOrderRequest('r', {
        uid: 'u', items: { medicineId: 'm1' } as unknown as [], status: 'pending', requestDate: ts(DATE),
      }, 'order_requests/r'),
      MalformedDataError,
    );
  });
});