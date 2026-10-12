/**
 * Stage 6 - the schedule rules, ported from A2 (AdminOrderProcessor.kt).
 *
 * A2 lines 37-42 and 94-116. The single business timezone is `Asia/Damascus`
 * (A2 line 81 and the Cloud Function's `BUSINESS_TIMEZONE` agree).
 *
 * PURE: the instant is always passed in; this module never reads the clock.
 */

import { formatMonthYear } from './month-year';
import type { DomainTimestamp } from './models';
import { parseTimeToMinutes } from './order-rules';

/**
 * A2 line 37-42: `ScheduleSettings`.
 *
 * A2 builds this from `settings/app` with ITS OWN fallbacks (line 258-263), and
 * the Stage 5B repository mapper already applies the very same four fallbacks
 * (15 / false / "06:00" / "10:00"), so the values arriving here are resolved.
 * The defaults below exist only so the function is total in isolation.
 */
export interface ScheduleSettings {
  readonly allowFridayOrders: boolean;
  readonly startTime: string;
  readonly endTime: string;
  readonly minDaysBetweenOrders: number;
}

/** A2 line 260-262: the settings fallbacks, kept in one place. */
export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = Object.freeze({
  allowFridayOrders: false,
  startTime: '06:00',
  endTime: '10:00',
  minDaysBetweenOrders: 15,
});

/** The single business timezone (A2 line 81). */
export const BUSINESS_TIME_ZONE = 'Asia/Damascus';

/** The Damascus-time fields A2 reads from its `Calendar` (lines 100-107). */
export interface DamascusCalendarParts {
  /** 0 = Sunday ... 6 = Friday, i.e. Java's `Calendar.DAY_OF_WEEK - 1`. */
  readonly dayOfWeek: number;
  readonly hour: number;
  readonly minute: number;
}

/** Sunday-first index. Java's `Calendar.DAY_OF_WEEK` is 1-based from Sunday. */
const DAY_OF_WEEK_INDEX: Readonly<Record<string, number>> = Object.freeze({
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
});

/** A2 line 80-85: `getDamascusCalendar`, reduced to the three fields A2 reads. */
export function getDamascusCalendarParts(timestamp: DomainTimestamp): DamascusCalendarParts {
  const instant = timestamp.toDate();
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, weekday: 'short' })
    .format(instant);
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  // `% 24` guards against Intl rendering midnight as "24" in some ICU versions.
  const hour = Number.parseInt(timeParts.find((part) => part.type === 'hour')?.value ?? '0', 10) % 24;
  const minute = Number.parseInt(timeParts.find((part) => part.type === 'minute')?.value ?? '0', 10);

  return { dayOfWeek: DAY_OF_WEEK_INDEX[weekday] ?? 0, hour, minute };
}

/** A2 line 100: `Calendar.FRIDAY`. */
export const DAY_OF_WEEK_FRIDAY = 5;

/**
 * A2's `monthYear` in one call, in the BUSINESS time zone.
 *
 * A2 formats the month from the same `getDamascusCalendar` object it uses for
 * the weekday, so the two can never disagree about which day a request belongs
 * to. Deriving the month separately from a fresh `formatMonthYear` call would
 * reintroduce exactly that risk at a zone boundary, which is why the two live
 * together here.
 *
 * D1 is NOT addressed: the legacy Arabic-Indic `monthYear` that exists in
 * production is never rewritten by this call - it is only ever compared through
 * `isSameMonthYear`, which returns false for an unrecognisable value.
 */
export function getDamascusMonthYear(timestamp: DomainTimestamp): string {
  return formatMonthYear(timestamp.toDate(), BUSINESS_TIME_ZONE);
}

/**
 * A2 line 94-116: `validateScheduleAndTime`.
 *
 * CHECK ORDER IS A2's: Friday first, then the window.
 * The window is INCLUSIVE on both ends (`<` and `>`, not `<=`/`>=`) - A2 line 111.
 */
export function validateScheduleAndTime(
  requestTimestamp: DomainTimestamp,
  settings: ScheduleSettings,
): { readonly error: string | null } {
  const damascus = getDamascusCalendarParts(requestTimestamp);

  if (!settings.allowFridayOrders && damascus.dayOfWeek === DAY_OF_WEEK_FRIDAY) {
    return { error: 'Orders are not allowed on Fridays' };
  }

  const currentMins = damascus.hour * 60 + damascus.minute;
  const startMins = parseTimeToMinutes(settings.startTime);
  const endMins = parseTimeToMinutes(settings.endTime);

  if (currentMins < startMins || currentMins > endMins) {
    return {
      error: `Orders allowed only between ${settings.startTime} and ${settings.endTime} (Asia/Damascus)`,
    };
  }
  return { error: null };
}
