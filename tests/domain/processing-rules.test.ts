import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregateItems, MAX_RAW_ITEMS, parseTimeToMinutes } from '../../electron/domain/order-rules';
import {
  BUSINESS_TIME_ZONE,
  DEFAULT_SCHEDULE_SETTINGS,
  getDamascusCalendarParts,
  validateScheduleAndTime,
} from '../../electron/domain/schedule';
import { validateUserEligibility } from '../../electron/domain/eligibility';
import type { DomainTimestamp, User } from '../../electron/domain/models';
import {
  isAlreadyProcessed,
  isBusinessValidationFailure,
  isRawStatusPending,
  isSuccess,
  RAW_STATUS_ABSENT,
  type ProcessingResult,
} from '../../electron/domain/results';
import { FirestoreTimestamp } from '../../electron/services/firestore-codec';

/**
 * Stage 6 T1 - the pure item rules of A2 `AdminOrderProcessor`.
 *
 * Every expectation is a restatement of an A2 line, because these strings and
 * this ORDER are what the Windows processor must reproduce exactly. The cases
 * mirror A2's own `AdminOrderProcessorTest` scenarios.
 *
 * PURE: nothing here touches Firestore, so this file needs no emulator.
 */

/** Builds a `DomainTimestamp` from Damascus wall-clock fields. */
export function damascus(y: number, month: number, day: number, hour = 0, minute = 0): DomainTimestamp {
  // Asia/Damascus is UTC+3 all year (no DST), so UTC = local - 3h.
  return FirestoreTimestamp.parse(new Date(Date.UTC(y, month - 1, day, hour - 3, minute)).toISOString());
}

describe('Stage 6: parseTimeToMinutes (A2:74-78)', () => {
  it('parses a well-formed HH:mm value', () => {
    assert.equal(parseTimeToMinutes('06:00'), 360);
    assert.equal(parseTimeToMinutes('10:30'), 630);
    assert.equal(parseTimeToMinutes('23:59'), 1439);
  });

  it('yields 0 for a malformed value, exactly as A2 does', () => {
    // A2's documented consequence: "garbage" becomes midnight.
    assert.equal(parseTimeToMinutes('garbage'), 0);
    assert.equal(parseTimeToMinutes('06'), 0);
    assert.equal(parseTimeToMinutes('06:00:00'), 0);
    assert.equal(parseTimeToMinutes(''), 0);
  });
});

describe('Stage 6: aggregateItems (A2:44-72)', () => {
  it('accepts a single valid line', () => {
    const result = aggregateItems([{ medicineId: 'm1', quantity: 2 }]);
    assert.equal(result.error, null);
    assert.deepEqual(result.items, [{ medicineId: 'm1', quantity: 2 }]);
  });

  it('sums duplicate medicine ids', () => {
    const result = aggregateItems([
      { medicineId: 'm1', quantity: 2 },
      { medicineId: 'm1', quantity: 3 },
    ]);
    assert.equal(result.error, null);
    assert.deepEqual(result.items, [{ medicineId: 'm1', quantity: 5 }]);
  });

  it('rejects an empty list', () => {
    assert.equal(aggregateItems([]).error, 'Invalid request structure or empty items list');
  });

  it('rejects more than five RAW items, before aggregation', () => {
    // Six lines but only FIVE distinct medicines: the RAW count decides, so this
    // is refused even though aggregation would leave five items.
    const result = aggregateItems([
      { medicineId: 'm1', quantity: 1 },
      { medicineId: 'm2', quantity: 1 },
      { medicineId: 'm3', quantity: 1 },
      { medicineId: 'm4', quantity: 1 },
      { medicineId: 'm5', quantity: 1 },
      { medicineId: 'm1', quantity: 1 },
    ]);
    assert.equal(result.error, 'Maximum 5 items per order');
    assert.equal(result.items, null);
  });

  it('accepts exactly five raw items', () => {
    const result = aggregateItems([
      { medicineId: 'm1', quantity: 1 },
      { medicineId: 'm2', quantity: 1 },
      { medicineId: 'm3', quantity: 1 },
      { medicineId: 'm4', quantity: 1 },
      { medicineId: 'm5', quantity: 1 },
    ]);
    assert.equal(result.error, null);
    assert.equal(result.items?.length, MAX_RAW_ITEMS);
  });
});


describe('Stage 6: aggregateItems - structural refusals', () => {
  it('rejects a non-object line', () => {
    assert.equal(aggregateItems(['m1']).error, 'Invalid item structure in request');
    assert.equal(aggregateItems([null]).error, 'Invalid item structure in request');
    assert.equal(aggregateItems([['m1', 1]]).error, 'Invalid item structure in request');
  });

  it('rejects a non-string medicine id', () => {
    assert.equal(aggregateItems([{ medicineId: 7, quantity: 1 }]).error, 'Invalid item structure in request');
  });

  it('rejects a non-numeric or non-integral quantity', () => {
    assert.equal(
      aggregateItems([{ medicineId: 'm1', quantity: '2' }]).error,
      'Invalid item structure in request',
    );
    assert.equal(
      aggregateItems([{ medicineId: 'm1', quantity: 1.5 }]).error,
      'Invalid item structure in request',
    );
  });

  it('rejects a blank medicine id', () => {
    assert.equal(
      aggregateItems([{ medicineId: '   ', quantity: 1 }]).error,
      'Invalid item or quantity for medicine    ',
    );
  });

  it('rejects a non-positive quantity', () => {
    assert.equal(
      aggregateItems([{ medicineId: 'm1', quantity: 0 }]).error,
      'Invalid item or quantity for medicine m1',
    );
    assert.equal(
      aggregateItems([{ medicineId: 'm1', quantity: -3 }]).error,
      'Invalid item or quantity for medicine m1',
    );
  });

  it('rejects an aggregation that would overflow', () => {
    const result = aggregateItems([
      { medicineId: 'm1', quantity: Number.MAX_SAFE_INTEGER },
      { medicineId: 'm1', quantity: 1 },
    ]);
    assert.equal(result.error, 'Quantity aggregation overflow for medicine m1');
  });
});

describe('Stage 6: getDamascusCalendarParts (A2:80-85)', () => {
  it('reads the weekday in Asia/Damascus', () => {
    // 2026-06-03 is a Wednesday, 2026-06-05 a Friday, in Damascus.
    assert.equal(getDamascusCalendarParts(damascus(2026, 6, 3, 8, 0)).dayOfWeek, 3);
    assert.equal(getDamascusCalendarParts(damascus(2026, 6, 5, 8, 0)).dayOfWeek, 5);
  });

  it('reads the wall clock in Asia/Damascus', () => {
    const parts = getDamascusCalendarParts(damascus(2026, 6, 3, 8, 15));
    assert.equal(parts.hour, 8);
    assert.equal(parts.minute, 15);
  });

  it('uses the single business timezone', () => {
    assert.equal(BUSINESS_TIME_ZONE, 'Asia/Damascus');
  });
});

describe('Stage 6: validateScheduleAndTime (A2:94-116)', () => {
  const settings = DEFAULT_SCHEDULE_SETTINGS;

  it('accepts a time inside the window', () => {
    assert.deepEqual(validateScheduleAndTime(damascus(2026, 6, 3, 8, 0), settings), { error: null });
  });

  it('refuses a Friday when Friday orders are disabled', () => {
    assert.deepEqual(validateScheduleAndTime(damascus(2026, 6, 5, 8, 0), settings), {
      error: 'Orders are not allowed on Fridays',
    });
  });

  it('allows a Friday when the setting permits it', () => {
    assert.deepEqual(
      validateScheduleAndTime(damascus(2026, 6, 5, 8, 0), { ...settings, allowFridayOrders: true }),
      { error: null },
    );
  });

  it('refuses a time outside the window', () => {
    assert.equal(
      validateScheduleAndTime(damascus(2026, 6, 3, 5, 30), settings).error,
      'Orders allowed only between 06:00 and 10:00 (Asia/Damascus)',
    );
    assert.equal(
      validateScheduleAndTime(damascus(2026, 6, 3, 10, 30), settings).error,
      'Orders allowed only between 06:00 and 10:00 (Asia/Damascus)',
    );
  });

  it('treats BOTH window ends as inclusive', () => {
    // A2 line 111 uses < and >, so exactly 06:00 and exactly 10:00 pass.
    assert.equal(validateScheduleAndTime(damascus(2026, 6, 3, 6, 0), settings).error, null);
    assert.equal(validateScheduleAndTime(damascus(2026, 6, 3, 10, 0), settings).error, null);
  });

  it('checks Friday BEFORE the window (A2 order)', () => {
    // A Friday at 03:00 breaks both rules; A2 reports the Friday one.
    assert.equal(
      validateScheduleAndTime(damascus(2026, 6, 5, 3, 0), settings).error,
      'Orders are not allowed on Fridays',
    );
  });

/** A2's fixture user, carrying only the fields the eligibility check reads. */
function user(overrides: Partial<User> = {}): User {
  return {
    uid: 'uid-patient',
    name: 'Nour',
    employeeId: 'E-1',
    role: 'employee',
    status: 'approved',
    hasException: false,
    lastOrderId: null,
    lastOrderDate: null,
    lastOrderMonthYear: '',
    lastOrderStatus: null,
    lastOrderIsException: false,
    ...overrides,
  } as User;
}

describe('Stage 6: validateUserEligibility (A2:118-153)', () => {
  const now = damascus(2026, 6, 3, 8, 0);

  it('refuses a user who is not approved (step 1 runs FIRST)', () => {
    // Step 2's exception bypass must NOT rescue an unapproved user.
    assert.equal(
      validateUserEligibility(user({ status: 'pending', hasException: true }), now, 15).error,
      'User is not approved to make orders',
    );
  });

  it('lets an exception bypass every later step (step 2)', () => {
    // Pending-order lock, same month, AND inside the minimum interval: the
    // exception must win over all three at once.
    assert.equal(
      validateUserEligibility(
        user({
          hasException: true,
          lastOrderStatus: 'pending',
          lastOrderMonthYear: '06-2026',
          lastOrderDate: damascus(2026, 6, 1, 8, 0),
        }),
        now,
        15,
      ).error,
      null,
    );
  });

  it('refuses when the last order is still pending (step 4a)', () => {
    assert.equal(
      validateUserEligibility(user({ lastOrderStatus: 'pending' }), now, 15).error,
      'You already have a pending order',
    );
  });

  it('refuses when the month already matches (step 4b)', () => {
    assert.equal(
      validateUserEligibility(user({ lastOrderMonthYear: '06-2026' }), now, 15).error,
      'You have already ordered this month',
    );
  });

  it('refuses a legacy Arabic-Indic month in the SAME month (D1, step 4b)', () => {
    // A2's raw `==` silently MISSES this and lets a second order through; the
    // compatibility helper is what closes the hole without rewriting any data.
    assert.equal(
      validateUserEligibility(user({ lastOrderMonthYear: '٠٦-٢٠٢٦' }), now, 15).error,
      'You have already ordered this month',
    );
  });

  it('allows a new user, whose monthYear is blank (step 4b guard)', () => {
    assert.equal(validateUserEligibility(user(), now, 15).error, null);
    assert.equal(validateUserEligibility(user({ lastOrderMonthYear: '   ' }), now, 15).error, null);
  });

  it('allows a different month', () => {
    assert.equal(validateUserEligibility(user({ lastOrderMonthYear: '05-2026' }), now, 15).error, null);
    assert.equal(validateUserEligibility(user({ lastOrderMonthYear: '06-2027' }), now, 15).error, null);
  });

  it('refuses inside the minimum interval and FLOORS the day count (step 4c)', () => {
    // 14.9 days must be treated as 14 days, so minDays=15 refuses it.
    assert.equal(
      validateUserEligibility(user({ lastOrderDate: damascus(2026, 5, 19, 20, 30) }), now, 15).error,
      'Minimum interval between orders is 15 days',
    );
  });

  it('allows exactly the minimum interval', () => {
    assert.equal(
      validateUserEligibility(user({ lastOrderDate: damascus(2026, 5, 19, 8, 0) }), now, 15).error,
      null,
    );
  });

  it('interpolates the configured interval into the message', () => {
    assert.equal(
      validateUserEligibility(user({ lastOrderDate: damascus(2026, 6, 1, 8, 0) }), now, 30).error,
      'Minimum interval between orders is 30 days',
    );
  });

  it('skips 4a-4c for a retryable rejected order (step 3)', () => {
    assert.equal(
      validateUserEligibility(
        user({
          lastOrderStatus: 'rejected',
          lastOrderIsException: false,
          lastOrderMonthYear: '06-2026',
          lastOrderDate: damascus(2026, 6, 1, 8, 0),
        }),
        now,
        15,
      ).error,
      null,
    );
  });

  it('does NOT treat a rejected EXCEPTION order as retryable (step 3)', () => {
    // A2 requires `!lastOrderIsException`, so this user stays locked.
    assert.equal(
      validateUserEligibility(
        user({ lastOrderStatus: 'rejected', lastOrderIsException: true, lastOrderMonthYear: '06-2026' }),
        now,
        15,
      ).error,
      'You have already ordered this month',
    );
  });
});

describe('Stage 6: ProcessingResult (A2:13-17)', () => {
  it('narrows each of the three variants', () => {
    const success: ProcessingResult = { kind: 'success', orderId: 'o1' };
    const failure: ProcessingResult = { kind: 'business-validation-failure', reason: 'no' };
    const already: ProcessingResult = { kind: 'already-processed', status: 'processed' };

    assert.ok(isSuccess(success));
    assert.ok(isBusinessValidationFailure(failure));
    assert.ok(isAlreadyProcessed(already));

    assert.equal(isSuccess(failure), false);
    assert.equal(isBusinessValidationFailure(already), false);
    assert.equal(isAlreadyProcessed(success), false);
  });

  it('treats only exactly "pending" as processable', () => {
    assert.equal(isRawStatusPending('pending'), true);
    assert.equal(isRawStatusPending('processed'), false);
    assert.equal(isRawStatusPending('failed'), false);
    assert.equal(isRawStatusPending(''), false);
    assert.equal(isRawStatusPending(undefined), false);
    assert.equal(isRawStatusPending(null), false);
  });

  it('maps an absent raw status to the empty string A2 reads', () => {
    // A2's `getString("status") ?: ""`. A missing status is NOT 'pending', which
    // is exactly what makes it an AlreadyProcessed outcome instead of a default.
    assert.equal(RAW_STATUS_ABSENT, '');
    assert.equal(isRawStatusPending(RAW_STATUS_ABSENT), false);
  });
});

});
