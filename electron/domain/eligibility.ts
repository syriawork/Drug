/**
 * Stage 6 - user eligibility, ported from A2 (AdminOrderProcessor.kt:118-153).
 *
 * THIS FUNCTION IS ORDER-SENSITIVE. Three minutes of reordering change the
 * behaviour, and A2's Robolectric cases assert each of them:
 *
 *  1. The approval check runs FIRST, before the exception bypass.
 *  2. `hasException` bypasses steps 3-6 entirely - including the
 *     "already a pending order" lock (A2 test `testExceptionUserBypass`).
 *  3. The monthly check is guarded by a blank test, which is what makes a NEW
 *     user (`lastOrderMonthYear == ""`) pass safely.
 *  4. `diffDays` FLOORS: 14.9 days is 14, so it is refused at `minDays = 15`
 *     (A2 test `testMinimumDayViolation`).
 *
 * PURE: the instant is passed in; this module never reads the clock.
 */

import type { DomainTimestamp, User } from './models';
import { formatMonthYear, isSameMonthYear } from './month-year';

/** A2 line 143-147: the message interpolates the configured interval. */
function minimumIntervalError(minDaysBetweenOrders: number): string {
  return `Minimum interval between orders is ${minDaysBetweenOrders} days`;
}

/**
 * A2 line 118-153: `validateUserEligibility`.
 *
 * `user` is the Stage 5B `User` model, which already carries the denormalised
 * summary A2 reads field-by-field (line 236-243). Note the summary is the ONLY
 * source of truth: A2 cannot query `orders` inside a transaction, so nothing here
 * reads the orders collection.
 */
export function validateUserEligibility(
  user: User,
  requestTimestamp: DomainTimestamp,
  minDaysBetweenOrders: number,
): { readonly error: string | null } {
  // Step 1 - A2 line 123-125. Note it compares the DOMAIN status, so an
  // unknown persisted status (mapped to 'pending' by the mapper) is refused.
  if (user.status !== 'approved') {
    return { error: 'User is not approved to make orders' };
  }

  // Step 2 - A2 line 127-129. The bypass is TOTAL and comes before everything.
  if (user.hasException) {
    return { error: null };
  }

  // Step 3 - A2 line 131.
  const canRetryRecord = user.lastOrderStatus === 'rejected' && !user.lastOrderIsException;

  // Step 4 - A2 line 133-150.
  if (!canRetryRecord) {
    // 4a - A2 line 134-136.
    if (user.lastOrderStatus === 'pending') {
      return { error: 'You already have a pending order' };
    }

    // 4b - A2 line 138-141. The blank guard is load-bearing for new users.
    //
    // A2 compares the raw strings with `==`, which is BROKEN for the legacy
    // Arabic-Indic monthYear that really exists in production (D1):
    // "٠٥-٢٠٢٦" == "05-2026" is always false, silently disabling the one-order-
    // per-month rule for exactly the users most likely to hit it. Stage 4 D1 and
    // domain/month-year.ts resolve this explicitly through `isSameMonthYear`,
    // which returns FALSE for an unrecognisable value - so an unknown month is
    // never silently treated as "same month". The STORED value is never
    // rewritten; only the comparison changes. No production `monthYear`
    // normalisation is in scope for Stage 6.
    if (user.lastOrderMonthYear.trim().length > 0) {
      const requestMonthYear = formatMonthYear(requestTimestamp.toDate());
      if (isSameMonthYear(user.lastOrderMonthYear, requestMonthYear)) {
        return { error: 'You have already ordered this month' };
      }
    }

    // 4c - A2 line 143-149, including the integer flooring.
    if (user.lastOrderDate !== null) {
      const diffMillis = requestTimestamp.toDate().getTime() - user.lastOrderDate.toDate().getTime();
      // A2 line 145: `diffMillis / (1000 * 60 * 60 * 24)` is a Long division, so
      // it FLOORS toward zero. `Math.floor` reproduces that for positive values.
      const diffDays = Math.floor(diffMillis / 86_400_000);
      if (diffDays < minDaysBetweenOrders) {
        return { error: minimumIntervalError(minDaysBetweenOrders) };
      }
    }
  }

  // Step 5 - A2 line 152.
  return { error: null };
}
