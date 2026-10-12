import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapNewUserProfile, mapUserAdministrativeUpdate } from '../../electron/repositories/firestore/mappers/user-mapper';
import { mapNewMedicine } from '../../electron/repositories/firestore/mappers/medicine-mapper';
import {
  ALLOWED_CREATE_KEYS,
  mapNewOrderRequest,
} from '../../electron/repositories/firestore/mappers/order-request-mapper';
import { mapAppSettings, mapAppSettingsWrite } from '../../electron/repositories/firestore/mappers/order-mapper';
import { FirestoreTimestamp, SERVER_TIMESTAMP } from '../../electron/services/firestore-codec';

/**
 * Stage 5B (PART 13-B) - domain -> Firestore WRITE mapping.
 *
 * These assertions encode the two rules that are easy to break silently and
 * expensive to discover in production:
 *
 *  1. `order_requests` creation is constrained by
 *     `keys().hasOnly(['uid','items','status','requestDate'])`, so the payload
 *     must contain EXACTLY those keys. One extra key means HTTP 403.
 *  2. `requestDate` must be the SERVER_TIMESTAMP marker (decision D4), never a
 *     client clock reading and never a string.
 */

describe('Stage 5B/B: new user profile payload', () => {
  it('pins role/status/hasException to the values the rules force', () => {
    const data = mapNewUserProfile({ uid: 'u1', name: 'موظف', employeeId: '100' });
    assert.deepEqual(data, {
      uid: 'u1', name: 'موظف', employeeId: '100', role: 'employee', status: 'pending', hasException: false,
    });
  });
});

describe('Stage 5B/B: administrative user update is masked', () => {
  it('returns data and a matching mask so the two cannot drift', () => {
    const { data, maskPaths } = mapUserAdministrativeUpdate({ status: 'approved' });
    assert.deepEqual(data, { status: 'approved' });
    assert.deepEqual([...maskPaths], ['status']);
  });

  it('lists every changed field in the mask', () => {
    const { data, maskPaths } = mapUserAdministrativeUpdate({ name: 'س', status: 'rejected', hasException: true });
    assert.deepEqual([...maskPaths].sort(), ['hasException', 'name', 'status']);
    assert.deepEqual(Object.keys(data).sort(), ['hasException', 'name', 'status']);
  });

  it('refuses an empty update (it would be a full-document wipe)', () => {
    assert.throws(() => mapUserAdministrativeUpdate({}), /at least one field/);
  });
});

describe('Stage 5B/B: new medicine payload', () => {
  it('initialises the counters the way the Android dialog does', () => {
    assert.deepEqual(mapNewMedicine({ name: 'x', maxQuantity: 3, initialStock: 10 }), {
      name: 'x', maxQuantity: 3, stock: 10, totalInward: 10, totalOutward: 0,
    });
  });
});

describe('Stage 5B/B: order request creation payload', () => {
  const items = [{ medicineId: 'm1', medicineName: 'باراسيتامول', quantity: 2 }];

  it('contains EXACTLY the four keys the rules allow', () => {
    const { data } = mapNewOrderRequest({ uid: 'u1', items });
    assert.deepEqual(Object.keys(data).sort(), [...ALLOWED_CREATE_KEYS].sort());
  });

  it('never carries a processing field at creation time', () => {
    const { data } = mapNewOrderRequest({ uid: 'u1', items });
    for (const forbidden of ['orderId', 'error', 'processedBy', 'processedAt', 'source', 'idempotencyKey']) {
      assert.equal(forbidden in data, false, `forbidden key present: ${forbidden}`);
    }
  });

  it('fixes status to pending, as the rules require', () => {
    assert.equal(mapNewOrderRequest({ uid: 'u1', items }).data['status'], 'pending');
  });

  it('uses the SERVER_TIMESTAMP marker, never a string or a Date (D4)', () => {
    const { data } = mapNewOrderRequest({ uid: 'u1', items });
    const marker = data['requestDate'];
    assert.ok(marker instanceof Object, 'a server timestamp must be a marker object, not a string');
    assert.equal(marker, SERVER_TIMESTAMP, 'it must be the canonical singleton marker');
    assert.notEqual(typeof marker, 'string');
  });

  it('declares the write as a create, so an existing id cannot be overwritten', () => {
    assert.equal(mapNewOrderRequest({ uid: 'u1', items }).kind, 'create');
  });

  it('copies the item lines verbatim (the rules never validate their shape)', () => {
    const { data } = mapNewOrderRequest({ uid: 'u1', items });
    assert.deepEqual(data['items'], items);
  });
});

describe('Stage 5B/B: settings write payload', () => {
  it('round-trips the mapped settings through the write payload', () => {
    const settings = mapAppSettings({ minDaysBetweenOrders: 30, startTime: '07:00' });
    const written = mapAppSettingsWrite(settings);

    assert.equal(written['minDaysBetweenOrders'], 30);
    assert.equal(written['startTime'], '07:00');
    // Absent fields are written explicitly using the Android fallbacks.
    assert.equal(written['endTime'], '10:00');
    assert.equal(written['allowFridayOrders'], false);
  });
});

/** Guard: the marker must never be encodable as an ordinary value. */
describe('Stage 5B/B: the server timestamp marker is not a value', () => {
  it('is a distinct singleton, not a string equal to REQUEST_TIME', () => {
    assert.equal(SERVER_TIMESTAMP, SERVER_TIMESTAMP);
    assert.notEqual(SERVER_TIMESTAMP, 'REQUEST_TIME');
  });

  it('lives beside FirestoreTimestamp, which is the value that IS written', () => {
    assert.notEqual(SERVER_TIMESTAMP, FirestoreTimestamp.parse('2026-06-03T08:00:00.000Z'));
  });
});