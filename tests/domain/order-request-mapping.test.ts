import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MalformedDataError } from '../../electron/domain/errors';
import {
  ALLOWED_CREATE_KEYS,
  mapOrderRequest,
} from '../../electron/repositories/firestore/mappers/order-request-mapper';
import { mapOrder } from '../../electron/repositories/firestore/mappers/order-mapper';
import { FirestoreTimestamp } from '../../electron/services/firestore-codec';

/**
 * Stage 5B mapping tests - order requests (E) and orders (F).
 */

const ts = (iso: string): FirestoreTimestamp => FirestoreTimestamp.parse(iso);
const REQUEST_DATE = '2026-06-03T08:00:00.000Z';

describe('Stage 5B/E: order request mapping', () => {
  it('maps a complete processed request', () => {
    const request = mapOrderRequest('req1', {
      uid: 'u1',
      items: [{ medicineId: 'm1', medicineName: 'باراسيتامول', quantity: 2 }],
      status: 'processed',
      requestDate: ts(REQUEST_DATE),
      orderId: 'order1',
      error: null,
      processedBy: 'admin1',
      processedAt: ts('2026-06-03T08:01:00.000Z'),
    }, 'order_requests/req1');

    assert.equal(request.id, 'req1');
    assert.equal(request.uid, 'u1');
    assert.equal(request.status, 'processed');
    assert.equal(request.orderId, 'order1');
    assert.equal(request.error, null);
    assert.equal(request.processedBy, 'admin1');
    assert.equal(request.items.length, 1);
    assert.equal(request.items[0]?.medicineId, 'm1');
    assert.equal(request.items[0]?.quantity, 2);
    assert.equal(request.requestDate.isoValue, REQUEST_DATE);
  });

  it('accepts the legacy processedBy literal "backend-v1" without complaint', () => {
    const request = mapOrderRequest('req1', {
      uid: 'u1', items: [], status: 'processed', requestDate: ts(REQUEST_DATE), processedBy: 'backend-v1',
    }, 'order_requests/req1');
    assert.equal(request.processedBy, 'backend-v1');
  });

  it('treats every processing field as optional', () => {
    const request = mapOrderRequest('req1', {
      uid: 'u1', items: [], status: 'pending', requestDate: ts(REQUEST_DATE),
    }, 'order_requests/req1');

    assert.equal(request.orderId, null);
    assert.equal(request.error, null);
    assert.equal(request.processedBy, null);
    assert.equal(request.processedAt, null);
  });

  it('requires requestDate to be a real timestamp, not a string', () => {
    // A2 reads it with getTimestamp: a string would make the Android side fail
    // the request with "Missing request timestamp".
    assert.throws(
      () => mapOrderRequest('r', { uid: 'u', items: [], status: 'pending', requestDate: REQUEST_DATE }, 'order_requests/r'),
      MalformedDataError,
    );
    assert.throws(
      () => mapOrderRequest('r', { uid: 'u', items: [], status: 'pending' }, 'order_requests/r'),
      MalformedDataError,
    );
  });

  it('reports an unknown status and falls back to pending', () => {
    const seen: string[] = [];
    const request = mapOrderRequest('r', {
      uid: 'u', items: [], status: 'queued', requestDate: ts(REQUEST_DATE),
    }, 'order_requests/r', (actual) => seen.push(actual));
    assert.equal(request.status, 'pending');
    assert.deepEqual(seen, ['queued']);
  });

  it('exposes exactly the four creation keys as the allowed set', () => {
    assert.deepEqual([...ALLOWED_CREATE_KEYS].sort(), ['items', 'requestDate', 'status', 'uid']);
  });
});

describe('Stage 5B/F: order mapping', () => {
  it('maps a complete order', () => {
    const order = mapOrder('o1', {
      userId: 'u1', userName: 'صيدلاني',
      items: [{ medicineId: 'm1', medicineName: 'x', quantity: 3 }],
      date: ts(REQUEST_DATE), monthYear: '06-2026', status: 'accepted',
      isExceptionOrder: true, requestId: 'req1',
    }, 'orders/o1');

    assert.equal(order.id, 'o1');
    assert.equal(order.userId, 'u1');
    assert.equal(order.userName, 'صيدلاني');
    assert.equal(order.status, 'accepted');
    assert.equal(order.isExceptionOrder, true);
    assert.equal(order.monthYear, '06-2026');
    assert.equal(order.requestId, 'req1');
    assert.equal(order.items[0]?.quantity, 3);
  });

  it('reads a missing isExceptionOrder as false (8 of 26 real orders)', () => {
    const order = mapOrder('o1', {
      userId: 'u1', items: [], date: ts(REQUEST_DATE), monthYear: '06-2026', status: 'pending',
    }, 'orders/o1');
    assert.equal(order.isExceptionOrder, false);
  });

  it('preserves a legacy Arabic-Indic monthYear verbatim', () => {
    const order = mapOrder('o1', {
      userId: 'u1', items: [], date: ts(REQUEST_DATE), monthYear: '٠٦-٢٠٢٦', status: 'pending',
    }, 'orders/o1');
    assert.equal(order.monthYear, '٠٦-٢٠٢٦');
  });

  it('tolerates a missing userName, requestId and monthYear', () => {
    const order = mapOrder('o1', {
      userId: 'u1', items: [], date: ts(REQUEST_DATE), status: 'pending',
    }, 'orders/o1');
    assert.equal(order.userName, '');
    assert.equal(order.requestId, null);
    assert.equal(order.monthYear, '');
  });
});