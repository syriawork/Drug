import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MalformedDataError } from '../../electron/domain/errors';
import { mapUser } from '../../electron/repositories/firestore/mappers/user-mapper';
import { mapMedicine } from '../../electron/repositories/firestore/mappers/medicine-mapper';
import { FirestoreTimestamp } from '../../electron/services/firestore-codec';

/**
 * Stage 5B mapping tests - user (C) and medicine (D), plus timestamp
 * preservation (I).
 *
 * Pure tests: decoded Firestore values in, domain models out. No network. The
 * user fixture is taken from the Android project's real production backup
 * (migration/users_backup_*.json), whose documents contain ONLY
 * {uid, role, name, employeeId, status}.
 */

const ts = (iso: string): FirestoreTimestamp => FirestoreTimestamp.parse(iso);

describe('Stage 5B/C: user mapping', () => {
  it('maps a real production document that has NO lastOrder* fields at all', () => {
    const user = mapUser('KXhJ5xWIoxToZ8zYWmoTRbHd9Hq1', {
      uid: 'KXhJ5xWIoxToZ8zYWmoTRbHd9Hq1',
      role: 'admin',
      name: 'Ù…Ø¯ÙŠØ± Ø§Ù„Ù†Ø¸Ø§Ù…',
      employeeId: '0000',
      status: 'approved',
    }, 'users/KXhJ5xWIoxToZ8zYWmoTRbHd9Hq1');

    assert.equal(user.uid, 'KXhJ5xWIoxToZ8zYWmoTRbHd9Hq1');
    assert.equal(user.role, 'admin');
    assert.equal(user.status, 'approved');
    assert.equal(user.hasException, false, 'absent hasException reads as false');
    assert.equal(user.lastOrderId, null);
    assert.equal(user.lastOrderDate, null);
    assert.equal(user.lastOrderMonthYear, '');
    assert.equal(user.lastOrderStatus, null);
    assert.equal(user.lastOrderIsException, false);
  });

  it('preserves the real production empty-string lastOrderStatus', () => {
    // A8 proposedSummary.lastOrderStatus === "" meaning "never ordered".
    const user = mapUser('u1', { role: 'employee', status: 'approved', lastOrderStatus: '' }, 'users/u1');
    assert.equal(user.lastOrderStatus, '', 'the empty string must NOT collapse to null');
  });

  it('preserves a legacy Arabic-Indic lastOrderMonthYear verbatim (no rewrite)', () => {
    const user = mapUser('u1', { role: 'employee', status: 'approved', lastOrderMonthYear: 'Ù Ù¦-Ù¢Ù Ù¢Ù¦' }, 'users/u1');
    assert.equal(user.lastOrderMonthYear, 'Ù Ù¦-Ù¢Ù Ù¢Ù¦');
  });

  it('keeps lastOrderDate as a FirestoreTimestamp, never a string or a Date', () => {
    const user = mapUser('u1', {
      role: 'employee', status: 'approved', lastOrderDate: ts('2026-06-03T08:00:00.123456Z'),
    }, 'users/u1');

    assert.ok(user.lastOrderDate instanceof FirestoreTimestamp);
    assert.equal((user.lastOrderDate as FirestoreTimestamp).isoValue, '2026-06-03T08:00:00.123456Z');
  });

  it('reports an unknown role/status instead of throwing, and falls back', () => {
    const warnings: string[] = [];
    const user = mapUser('u1', { role: 'Admin', status: 'APPROVED' }, 'users/u1', {
      onWarning: (w) => warnings.push(`${w.field}=${w.detail}`),
    });

    assert.equal(user.role, 'employee', 'unknown role falls back to the least privileged value');
    assert.equal(user.status, 'pending');
    assert.equal(warnings.length, 2, 'both surprises are reported, not swallowed');
  });

  it('derives uid from the document id, not from the stored field', () => {
    const user = mapUser('doc-id', { uid: 'different', role: 'employee', status: 'approved' }, 'users/doc-id');
    assert.equal(user.uid, 'doc-id', 'the document id is the Firebase Auth UID');
  });
});

describe('Stage 5B/D: medicine mapping', () => {
  it('maps a complete medicine document', () => {
    const medicine = mapMedicine('m1', {
      name: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', maxQuantity: 5, stock: 100, totalInward: 250, totalOutward: 150,
    }, 'medicines/m1');

    assert.deepEqual(medicine, {
      id: 'm1', name: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', maxQuantity: 5, stock: 100, totalInward: 250, totalOutward: 150,
    });
  });

  it('defaults the optional counters to 0', () => {
    const medicine = mapMedicine('m1', { name: 'x', maxQuantity: 1, stock: 2 }, 'medicines/m1');
    assert.equal(medicine.totalInward, 0);
    assert.equal(medicine.totalOutward, 0);
  });

  it('accepts a counter stored as a whole double (real data does this)', () => {
    const medicine = mapMedicine('m1', { name: 'x', maxQuantity: 1, stock: 5, totalInward: 10.0 }, 'medicines/m1');
    assert.equal(medicine.totalInward, 10);
  });

  it('rejects a fractional quantity instead of rounding it', () => {
    assert.throws(
      () => mapMedicine('m1', { name: 'x', maxQuantity: 1, stock: 2.5 }, 'medicines/m1'),
      MalformedDataError,
    );
  });

  it('rejects a missing required field rather than inventing a value', () => {
    assert.throws(() => mapMedicine('m1', { maxQuantity: 1, stock: 2 }, 'medicines/m1'), MalformedDataError);
    assert.throws(() => mapMedicine('m1', { name: 'x', stock: 2 }, 'medicines/m1'), MalformedDataError);
  });
});

describe('Stage 5B/I: timestamp preservation', () => {
  it('keeps nanosecond precision that a Date would truncate', () => {
    const user = mapUser('u1', {
      role: 'employee', status: 'approved', lastOrderDate: ts('2026-06-03T08:00:00.123456789Z'),
    }, 'users/u1');

    const value = user.lastOrderDate as FirestoreTimestamp;
    assert.notEqual(typeof value, 'string');
    assert.equal(value.isoValue, '2026-06-03T08:00:00.123456789Z');
    assert.equal(value.toDate().toISOString(), '2026-06-03T08:00:00.123Z');
  });
});