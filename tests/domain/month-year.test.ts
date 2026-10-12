import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatMonthYear,
  isMonthYearLike,
  isSameMonthYear,
  normalizeMonthYear,
} from '../../electron/domain/month-year';
import { FirestoreTimestamp } from '../../electron/services/firestore-codec';

/**
 * Stage 5B / PART 14 (D1) - `monthYear` read compatibility.
 *
 * The Arabic-Indic fixtures are taken VERBATIM from the Android project's real
 * production data (migration/audit_report.json), so the legacy shape is proven
 * rather than imagined.
 *
 * No test here writes to Firestore: normalisation is a read-side concern only.
 */

describe('Stage 5B/D1: monthYear read compatibility', () => {
  it('normalizes the legacy Arabic-Indic form to ASCII (real production shape)', () => {
    // These exact strings appear in migration/audit_report.json.
    assert.equal(normalizeMonthYear('٠٦-٢٠٢٦'), '06-2026');
    assert.equal(normalizeMonthYear('٠٥-٢٠٢٦'), '05-2026');
    assert.equal(normalizeMonthYear('٠١-٢٠٢٥'), '01-2025');
  });

  it('leaves an already-ASCII value untouched', () => {
    assert.equal(normalizeMonthYear('06-2026'), '06-2026');
    assert.equal(normalizeMonthYear('12-2026'), '12-2026');
  });

  it('treats both digit systems as the SAME month (this is what neutralises D1)', () => {
    assert.equal(isSameMonthYear('٠٦-٢٠٢٦', '06-2026'), true);
    assert.equal(isSameMonthYear('05-2026', '٠٥-٢٠٢٦'), true);
    assert.equal(isSameMonthYear('06-2026', '05-2026'), false);
  });

  it('returns null for values that are not a month, including the empty string', () => {
    // "" is the real production value meaning "never ordered" (A8).
    assert.equal(normalizeMonthYear(''), null);
    assert.equal(normalizeMonthYear('2026-06'), null);
    assert.equal(normalizeMonthYear('6-2026'), null);
    assert.equal(normalizeMonthYear('06_2026'), null);
    assert.equal(normalizeMonthYear('garbage'), null);
    assert.equal(isSameMonthYear('06-2026', ''), false, 'an unknown month is never "the same"');
  });

  it('recognises only well-formed months', () => {
    assert.equal(isMonthYearLike('06-2026'), true);
    assert.equal(isMonthYearLike('٠٦-٢٠٢٦'), true);
    assert.equal(isMonthYearLike('99-9999'), true, 'shape-valid even if not a real month');
    assert.equal(isMonthYearLike('06-26'), false);
  });

  it('formats the current month as ASCII in Asia/Damascus, like A2 Locale.US', () => {
    // 2026-06-01T00:30:00Z is 03:30 in Damascus (UTC+3) => still June.
    assert.equal(formatMonthYear(new Date('2026-06-01T00:30:00Z')), '06-2026');
    // 2026-05-31T22:00:00Z is 01:00 on 1 June in Damascus.
    assert.equal(formatMonthYear(new Date('2026-05-31T22:00:00Z')), '06-2026');
    // The output must never contain Arabic-Indic digits.
    assert.match(formatMonthYear(new Date()), /^\d{2}-\d{4}$/);
  });

  it('produces a value that normalises to itself (idempotent)', () => {
    const produced = formatMonthYear(new Date('2026-06-03T08:00:00Z'));
    assert.equal(normalizeMonthYear(produced), produced);
  });
});

/** Reusable timestamp helper for the sibling mapping suites. */
export const ts = (iso: string): FirestoreTimestamp => FirestoreTimestamp.parse(iso);