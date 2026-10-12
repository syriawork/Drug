/**
 * Stage 5B - `monthYear` read compatibility (Stage 4 conflict D1).
 *
 * ## The problem
 *
 * Production data stores `MM-yyyy` in TWO different digit systems, because
 * three call sites format it with two different locales:
 *
 *   - `AdminOrderProcessor.kt:89` -> SimpleDateFormat("MM-yyyy", Locale.US)  => ASCII  "06-2026"
 *   - `MainActivity.kt:149`       -> SimpleDateFormat(..., Locale.getDefault()) => "٠٦-٢٠٢٦" on an Arabic device
 *   - `MedicineOrderActivity.kt:172` -> same as above
 *
 * Real production data (migration/audit_report.json) contains the Arabic-Indic
 * form, e.g. "٠٦-٢٠٢٦" (U+0660..U+0669). The Android eligibility check compares
 * `user.lastOrderMonthYear == requestMonthYear` with `==`, so
 * `"٠٥-٢٠٢٦" == "05-2026"` is always false and the "one order per month" rule
 * is silently disabled for those users.
 *
 * ## What this module does - and does not do
 *
 * It provides an EXPLICIT, opt-in read normalisation so the Windows client can
 * compare months correctly:
 *
 *  - the RAW persisted value is always preserved (models.ts keeps it verbatim);
 *  - normalisation happens only when a caller explicitly asks for it;
 *  - nothing is ever written back: there is NO Firestore write in this module
 *    and none in the repositories (see docs/domain-data-architecture.md D1);
 *  - a value that is not a recognisable `MM-yyyy` returns `null` rather than a
 *    guess, so the caller can decide what "unknown month" means.
 *
 * Migrating the stored data is deliberately OUT OF SCOPE: it is a separate,
 * explicit operation (the Android project owns such a script), not a side
 * effect of reading.
 */

/** Arabic-Indic digits U+0660..U+0669 (٠..٩). */
const ARABIC_INDIC_ZERO = 0x0660;

/** The canonical ASCII pattern produced by A2: two digits, dash, four digits. */
const ASCII_MONTH_YEAR_PATTERN = /^(\d{2})-(\d{4})$/;

const ARABIC_INDIC_PATTERN = /^([٠-٩]{2})-([٠-٩]{4})$/;

/**
 * Converts one Arabic-Indic digit to its ASCII counterpart.
 * Returns `null` when the character is not an Arabic-Indic digit.
 */
function toAsciiDigit(character: string): string | null {
  const code = character.codePointAt(0);
  if (code === undefined || code < ARABIC_INDIC_ZERO || code > ARABIC_INDIC_ZERO + 9) {
    return null;
  }
  return String(code - ARABIC_INDIC_ZERO);
}

/** True when the string is a well-formed `MM-yyyy` in either digit system. */
export function isMonthYearLike(value: string): boolean {
  return normalizeMonthYear(value) !== null;
}

/**
 * Normalises a persisted `monthYear` to the canonical ASCII form.
 *
 * Returns `null` when the value is not a recognisable `MM-yyyy` (including the
 * empty string, which real production data uses to mean "never ordered").
 *
 * @example
 * normalizeMonthYear('06-2026')  // '06-2026' (already ASCII)
 * normalizeMonthYear('٠٦-٢٠٢٦')  // '06-2026' (legacy Arabic-Indic, D1)
 * normalizeMonthYear('')         // null  ("no record")
 */
export function normalizeMonthYear(value: string): string | null {
  if (value.length === 0) {
    return null;
  }

  const asciiMatch = ASCII_MONTH_YEAR_PATTERN.exec(value);
  if (asciiMatch !== null) {
    return value;
  }

  const arabicMatch = ARABIC_INDIC_PATTERN.exec(value);
  if (arabicMatch === null) {
    return null;
  }

  const monthDigits = arabicMatch[1] ?? '';
  const yearDigits = arabicMatch[2] ?? '';
  const month = [...monthDigits].map(toAsciiDigit).join('');
  const year = [...yearDigits].map(toAsciiDigit).join('');

  // The pattern already guarantees Arabic-Indic digits, so toAsciiDigit cannot
  // return null here; the check keeps the function total under `noUncheckedIndexedAccess`.
  if (month.length !== 2 || year.length !== 4) {
    return null;
  }
  return `${month}-${year}`;
}

/**
 * True when two persisted `monthYear` values denote the SAME month, regardless
 * of the digit system they were written with.
 *
 * This is the call that actually neutralises D1: it is what an eligibility check
 * should use instead of `===`.
 *
 * Returns `false` when either side is not a recognisable month, so an unknown
 * value can never be silently treated as "same month".
 */
export function isSameMonthYear(left: string, right: string): boolean {
  const normalizedLeft = normalizeMonthYear(left);
  const normalizedRight = normalizeMonthYear(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return false;
  }
  return normalizedLeft === normalizedRight;
}

/**
 * Builds the canonical ASCII `MM-yyyy` for a given instant, exactly as A2 does
 * with `SimpleDateFormat("MM-yyyy", Locale.US)` in the `Asia/Damascus` zone.
 *
 * This is the ONLY function in the project allowed to PRODUCE a month value, and
 * what it produces is always ASCII - which is the authority A2 establishes.
 *
 * @param instant the moment to format
 * @param timeZone IANA zone; defaults to the business zone used by A2/A7.
 */
export function formatMonthYear(instant: Date, timeZone = 'Asia/Damascus'): string {
  // en-US + explicit timeZone gives ASCII digits and the Damascus calendar date,
  // matching SimpleDateFormat("MM-yyyy", Locale.US) on a Asia/Damascus device.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  return `${month}-${year}`;
}