/**
 * Stage 5B - reading helpers shared by every mapper.
 *
 * These functions are the ONLY place where a Firestore-decoded value is
 * inspected. The domain models never see a raw value.
 *
 * Two principles run through this file:
 *
 *  1. REQUIRED vs OPTIONAL. A field the Android engine depends on (A2 reads
 *     `requestDate` with getTimestamp and fails the request when it is null) is
 *     REQUIRED: a missing or mistyped value raises `MalformedDataError` instead
 *     of silently becoming a default. A field the rules itself marks optional
 *     (e.g. `isExceptionOrder`, absent in 8 of 26 real orders) is read with a
 *     documented default.
 *
 *  2. NO SILENT COERCION. A number stored as `doubleValue` is accepted (real
 *     data and A4 both do this), but a non-numeric string is never parsed into a
 *     number, and an unknown enum value is never rewritten to a valid one.
 */

import { MalformedDataError } from '../../../domain/errors';
import type { DomainTimestamp, OrderItem } from '../../../domain/models';
import {
  isOrderStatus,
  isUserRole,
  isUserStatus,
} from '../../../domain/values';
import { FirestoreTimestamp } from '../../../services/firestore-codec';

/** The decoded shape of one Firestore field. */
export type RawValue = unknown;

/** The decoded field map of one Firestore document. */
export type RawFields = Readonly<Record<string, RawValue>>;

function describe(value: RawValue): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function malformed(fieldPath: string, expectation: string, actual: RawValue, documentPath: string | null): never {
  throw new MalformedDataError(
    fieldPath,
    `field "${fieldPath}" of ${documentPath ?? 'the document'} must be ${expectation} (received ${describe(actual)})`,
    documentPath,
  );
}

/** Reads a required string. */
export function requireString(
  fields: RawFields,
  field: string,
  documentPath: string,
  fieldLabel: string = field,
): string {
  const value = fields[field];
  if (typeof value !== 'string') {
    malformed(fieldLabel, 'a string', value, documentPath);
  }
  return value;
}

/** Reads an optional string; `null` and an absent field both yield `null`. */
export function optionalString(fields: RawFields, field: string): string | null {
  const value = fields[field];
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'string' ? value : null;
}

/** Reads a string, falling back to a documented default for legacy documents. */
export function stringOrDefault(fields: RawFields, field: string, fallback: string): string {
  const value = fields[field];
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  malformed(field, 'a string', value, null);
}

/**
 * Reads a whole number.
 *
 * The codec turns `integerValue` into a `number`, and a `doubleValue` also
 * decodes to a `number` (real data and A4 do this), so both are accepted. A
 * non-integral double is rejected: every counter in this schema is a whole
 * quantity, so a fractional one means the document is wrong.
 */
export function requireNumber(
  fields: RawFields,
  field: string,
  documentPath: string,
  fieldLabel: string = field,
): number {
  const value = fields[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    malformed(fieldLabel, 'a number', value, documentPath);
  }
  if (!Number.isInteger(value)) {
    malformed(fieldLabel, 'a whole number', value, documentPath);
  }
  return value;
}

/** Reads an optional number; an absent or null field yields `null`. */
export function optionalNumber(fields: RawFields, field: string): number | null {
  const value = fields[field];
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads a number with a documented default for legacy documents. */
export function numberOrDefault(fields: RawFields, field: string, fallback: number): number {
  const value = fields[field];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    malformed(field, 'a number', value, null);
  }
  return value;
}

/** Reads a required boolean. */
export function requireBoolean(fields: RawFields, field: string, documentPath: string): boolean {
  const value = fields[field];
  if (typeof value !== 'boolean') {
    malformed(field, 'a boolean', value, documentPath);
  }
  return value;
}

/** Reads a boolean, defaulting to `false` when the field is absent. */
export function booleanOrFalse(fields: RawFields, field: string): boolean {
  const value = fields[field];
  if (value === undefined || value === null) {
    return false;
  }
  return typeof value === 'boolean' ? value : false;
}

/**
 * Reads a Firestore timestamp.
 *
 * The decoded value MUST be a `FirestoreTimestamp` (Stage 5A). A plain string
 * means the document was written by something that stored the timestamp as text,
 * which A2 would read as `null` via `getTimestamp` and reject - so we surface it
 * as malformed instead of pretending the instant is known.
 */
export function requireTimestamp(fields: RawFields, field: string, documentPath: string): DomainTimestamp {
  const value = fields[field];
  if (value instanceof FirestoreTimestamp) {
    return value;
  }
  malformed(
    field,
    'a Firestore timestamp (not a string: the Android processor reads it with getTimestamp)',
    value,
    documentPath,
  );
}

/** Reads a timestamp, yielding `null` for an absent or null field. */
export function optionalTimestamp(fields: RawFields, field: string): DomainTimestamp | null {
  const value = fields[field];
  return value instanceof FirestoreTimestamp ? value : null;
}

/**
 * Reads an enum-like string.
 *
 * A value outside the known set is reported through `onUnknown` and then mapped
 * to `fallback`. We deliberately do NOT throw: production data may drift, and
 * refusing to display a document would be worse than showing it with a clearly
 * reported default. Callers that must ACT on the value (eligibility) should
 * treat an unknown value as "not eligible" and watch `onUnknown`.
 */
export function readEnum<T extends string>(
  fields: RawFields,
  field: string,
  isKnown: (value: string) => value is T,
  fallback: T,
  onUnknown: (actual: string) => void = () => undefined,
): T {
  const value = fields[field];
  if (typeof value === 'string' && isKnown(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    onUnknown(value);
  }
  return fallback;
}

/** Convenience wrappers so callers do not import the guards from the domain vocabulary. */
export function readUserRole(fields: RawFields, onUnknown?: (actual: string) => void): 'admin' | 'assistant' | 'employee' {
  return readEnum(fields, 'role', isUserRole, 'employee', onUnknown);
}

export function readUserStatus(fields: RawFields, onUnknown?: (actual: string) => void): 'pending' | 'approved' | 'rejected' {
  return readEnum(fields, 'status', isUserStatus, 'pending', onUnknown);
}

export function readOrderStatus(
  fields: RawFields,
  onUnknown?: (actual: string) => void,
): 'pending' | 'accepted' | 'rejected' {
  return readEnum(fields, 'status', isOrderStatus, 'pending', onUnknown);
}

/**
 * Reads `items` (array of `{medicineId, medicineName, quantity}`).
 *
 * firestore.rules only checks `items is list`; the per-line shape is validated by
 * A2 after reading. We validate it here too so a corrupt line is reported with
 * its index instead of surfacing later as a mysterious processing failure.
 */
export function readOrderItems(
  fields: RawFields,
  documentPath: string,
  field = 'items',
): readonly OrderItem[] {
  const value = fields[field];
  if (!Array.isArray(value)) {
    malformed(field, 'an array', value, documentPath);
  }

  return Object.freeze(value.map((entry: RawValue, index: number) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      malformed(`${field}[${index}]`, 'a map', entry, documentPath);
    }
    const line = entry as RawFields;
    // The INDEX must be part of the reported field path (items[1].quantity), not
    // only of the document label, or a caller cannot tell WHICH line is broken.
    const indexedField = `${field}[${index}]`;
    const indexedPath = `${documentPath}#${indexedField}`;
    const medicineId = requireString(line, 'medicineId', indexedPath, `${indexedField}.medicineId`);
    // medicineName is a snapshot; A2 tolerates its absence, so it is optional.
    const medicineName = stringOrDefault(line, 'medicineName', '');
    const quantity = requireNumber(line, 'quantity', indexedPath, `${indexedField}.quantity`);
    return Object.freeze({ medicineId, medicineName, quantity });
  }));
}