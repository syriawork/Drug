/**
 * Minimal, typed conversion between plain JavaScript values and the Firestore
 * REST "Value" representation (google.firestore.v1.Value as JSON).
 *
 * Only the types needed by the current data model are supported on purpose; an
 * unsupported runtime value throws instead of being silently dropped. Larger
 * Firestore features (bytes, geo points, document references) are intentionally
 * absent from this stage.
 *
 * Stage 5A additions (still pure, still network-free):
 *  - `FirestoreTimestamp`  : a literal `timestampValue`, decoded so that it stays
 *                            distinguishable from a plain string and preserves the
 *                            exact Firestore precision (see PART 4 decision below).
 *  - `SERVER_TIMESTAMP`    : an explicit request for a Firestore field transform
 *                            (`REQUEST_TIME`); it is NEVER encoded as a value and
 *                            NEVER confused with a literal timestamp.
 *  - field-path parsing/encoding for `updateMask.fieldPaths` / `fieldTransforms`.
 *  - `extractServerTimestamps`: splits caller data into ordinary fields +
 *                            transform paths before a commit is built.
 *
 * Timestamp decoding decision (PART 4):
 *  A Firestore `timestampValue` is decoded into `FirestoreTimestamp`, which keeps
 *  the exact RFC 3339 string received from the server (`isoValue`). It is NOT
 *  silently converted to a local `Date` (that would truncate sub-millisecond
 *  precision and hide the original Firestore type), and it is NOT decoded into a
 *  plain string (that would make it indistinguishable from `stringValue`).
 *  `FirestoreTimestamp.toDate()` performs the explicit, documented conversion.
 */

export class FirestoreCodecError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FirestoreCodecError';
  }
}

/** JSON shape of google.firestore.v1.Value (subset used by this stage). */
export interface FirestoreRawValue {
  readonly nullValue?: 'NULL_VALUE' | undefined;
  readonly booleanValue?: boolean | undefined;
  readonly integerValue?: string | undefined;
  readonly doubleValue?: number | undefined;
  readonly stringValue?: string | undefined;
  readonly timestampValue?: string | undefined;
  readonly arrayValue?: { readonly values?: readonly FirestoreRawValue[] | undefined } | undefined;
  readonly mapValue?: { readonly fields?: FirestoreFields | undefined } | undefined;
}

/** JSON shape of the "fields" map of a document. */
export type FirestoreFields = Readonly<Record<string, FirestoreRawValue>>;

/** Decoded document data. */
export type FirestoreDocumentData = Readonly<Record<string, unknown>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Encodes one JavaScript value into its Firestore REST representation. */
export function encodeValue(value: unknown): FirestoreRawValue {
  if (value === null) {
    return { nullValue: 'NULL_VALUE' };
  }
  if (value === undefined) {
    throw new FirestoreCodecError('undefined is not a valid Firestore value (use null instead)');
  }
  if (isServerTimestamp(value)) {
    throw new FirestoreCodecError(
      'SERVER_TIMESTAMP is a field-transform request, not a value: pass it inside '
      + 'FirestoreRestClient.commitWrites(...) data so it is sent as an updateTransforms '
      + 'entry (setToServerValue REQUEST_TIME). The PATCH endpoint cannot represent it.',
    );
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new FirestoreCodecError('NaN and Infinity are not valid Firestore numbers');
    }
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'bigint') {
    return { integerValue: value.toString() };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new FirestoreCodecError('Invalid Date cannot be encoded as a Firestore timestamp');
    }
    return { timestampValue: value.toISOString() };
  }
  if (value instanceof FirestoreTimestamp) {
    // Literal timestamp: re-emit the EXACT string Firestore gave us (no precision loss).
    return { timestampValue: value.isoValue };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { arrayValue: {} };
    }
    return { arrayValue: { values: value.map((item) => encodeValue(item)) } };
  }
  if (isPlainObject(value)) {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new FirestoreCodecError(`Unsupported Firestore value type: ${typeof value}`);
}

/** Encodes a document body (plain object) into a Firestore "fields" map. */
export function encodeFields(data: Record<string, unknown>): FirestoreFields {
  const fields: Record<string, FirestoreRawValue> = {};
  for (const [key, value] of Object.entries(data)) {
    fields[key] = encodeValue(value);
  }
  return Object.freeze(fields);
}

/** Decodes one Firestore REST value into a plain JavaScript value. */
export function decodeValue(value: FirestoreRawValue): unknown {
  if (value.nullValue !== undefined) {
    return null;
  }
  if (value.booleanValue !== undefined) {
    return value.booleanValue;
  }
  if (value.stringValue !== undefined) {
    return value.stringValue;
  }
  if (value.integerValue !== undefined) {
    const parsed = Number.parseInt(value.integerValue, 10);
    if (!Number.isFinite(parsed)) {
      throw new FirestoreCodecError(`Invalid integerValue received: ${value.integerValue}`);
    }
    return parsed;
  }
  if (value.doubleValue !== undefined) {
    return value.doubleValue;
  }
  if (value.timestampValue !== undefined) {
    return FirestoreTimestamp.parse(value.timestampValue);
  }
  if (value.arrayValue !== undefined) {
    const items = value.arrayValue.values ?? [];
    return items.map((item) => decodeValue(item));
  }
  if (value.mapValue !== undefined) {
    return decodeFields(value.mapValue.fields);
  }
  throw new FirestoreCodecError(
    'Unsupported Firestore value received (this stage supports null, boolean, number, string, '
    + 'timestamp, array and map values only)',
  );
}

/** Decodes a Firestore "fields" map into a plain JavaScript object. */
export function decodeFields(fields: FirestoreFields | undefined): FirestoreDocumentData {
  if (fields === undefined) {
    return Object.freeze({});
  }
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    data[key] = decodeValue(value);
  }
  return Object.freeze(data);
}

// ---------------------------------------------------------------------------
// Stage 5A: literal timestamps, server-timestamp transforms, field paths.
// ---------------------------------------------------------------------------

/**
 * RFC 3339 timestamp as Firestore writes it: `YYYY-MM-DDTHH:MM:SS[.1-9 digits]Z`
 * (Firestore answers with 0, 3, 6 or 9 fractional digits; offsets like +05:30
 * are accepted on input too).
 */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A literal Firestore `timestampValue`.
 *
 * Decoding keeps the EXACT string returned by Firestore (`isoValue`), so:
 *  - it stays distinguishable from a plain `stringValue` (different runtime type),
 *  - microsecond/nanosecond precision is preserved (a `Date` only keeps ms),
 *  - re-encoding a decoded timestamp writes back the identical string.
 * `toDate()` is the explicit, lossy-by-design conversion to a local `Date`.
 */
export class FirestoreTimestamp {
  private constructor(public readonly isoValue: string) {
    Object.freeze(this);
  }

  /** Validates a raw `timestampValue` string coming from (or going to) Firestore. */
  public static parse(rawValue: string): FirestoreTimestamp {
    if (typeof rawValue !== 'string' || !TIMESTAMP_PATTERN.test(rawValue)) {
      throw new FirestoreCodecError(`invalid Firestore timestamp string: ${String(rawValue)}`);
    }
    // The pattern above only checks the SHAPE. A syntactically valid string can
    // still name an instant that does not exist (month 13, day 45, hour 99);
    // accepting it would silently hand a meaningless value to the domain layer.
    if (Number.isNaN(new Date(rawValue).getTime())) {
      throw new FirestoreCodecError(`invalid Firestore timestamp instant: ${rawValue}`);
    }
    return new FirestoreTimestamp(rawValue);
  }

  /** Builds a literal timestamp from a local `Date` (millisecond precision). */
  public static fromDate(date: Date): FirestoreTimestamp {
    if (Number.isNaN(date.getTime())) {
      throw new FirestoreCodecError('Invalid Date cannot be encoded as a Firestore timestamp');
    }
    return new FirestoreTimestamp(date.toISOString());
  }

  /** Explicit conversion to a local `Date` (truncates to millisecond precision). */
  public toDate(): Date {
    return new Date(this.isoValue);
  }

  public toString(): string {
    return this.isoValue;
  }
}

/**
 * Marker meaning: "ask the Firestore SERVER for the current time" (REST field
 * transform `setToServerValue: REQUEST_TIME`). It is deliberately NOT a string,
 * NOT a `Date` and NOT encodable as a value: `encodeValue(SERVER_TIMESTAMP)`
 * throws so a server timestamp can never be written as an ordinary string or a
 * client clock reading. Only `FirestoreRestClient.commitWrites` understands it
 * (it becomes an `updateTransforms` entry).
 */
export class FirestoreServerTimestamp {
  /**
   * Nominal brand: no runtime data of its own, but it makes this class
   * structurally non-empty, which is what keeps the type guard below usable.
   *
   * Without it the class is structurally `{}`, so `isServerTimestamp(value)`
   * would narrow the value to `never` in its negative branch, and every
   * subsequent narrowing in the same scope (`Array.isArray`, `instanceof Date`,
   * `value.toString()`, ...) would resolve against `never` and fail to
   * compile. The guard would silently poison the whole analysis chain.
   */
  public readonly [Symbol.toStringTag] = 'FirestoreServerTimestamp';

  private constructor() {
    Object.freeze(this);
  }

  public static readonly INSTANCE = new FirestoreServerTimestamp();
}

/** The explicit server-timestamp request marker (see `FirestoreServerTimestamp`). */
export const SERVER_TIMESTAMP: FirestoreServerTimestamp = FirestoreServerTimestamp.INSTANCE;

/** True when `value` is the explicit server-timestamp marker. */
export function isServerTimestamp(value: unknown): value is FirestoreServerTimestamp {
  return value === SERVER_TIMESTAMP;
}

// ---------------------------------------------------------------------------
// Field paths (updateMask.fieldPaths / fieldTransforms[].fieldPath).
//
// Firestore grammar (google.firestore.v1.Document, verified against the local
// emulator's validator):
//   path       := segment ("." segment)*
//   segment    := simple | quoted
//   simple     := [a-zA-Z_][a-zA-Z_0-9]*          (must not start with a digit)
//   quoted     := "`" ( [^`\] | "\" . )* "`"      (backslash escapes ` and \)
// A segment whose field name matches /^__.*__$/ is reserved and rejected.
// ---------------------------------------------------------------------------

const SIMPLE_FIELD_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const RESERVED_FIELD_NAME_PATTERN = /^__.*__$/;

function fieldPathError(message: string): FirestoreCodecError {
  return new FirestoreCodecError(message);
}

function decodeFieldPathSegment(segment: string, fullPath: string): string {
  if (segment.length === 0) {
    throw fieldPathError(`empty segment in field path: "${fullPath}"`);
  }

  let name: string;
  if (segment.startsWith('`')) {
    if (segment.length < 2 || !segment.endsWith('`')) {
      throw fieldPathError(`malformed quoted segment in field path: "${fullPath}"`);
    }
    const inner = segment.slice(1, -1);
    let unescaped = '';
    let index = 0;
    while (index < inner.length) {
      const char = inner.charAt(index);
      if (char === '\\') {
        if (index + 1 >= inner.length) {
          throw fieldPathError(`dangling escape in field path: "${fullPath}"`);
        }
        unescaped += inner.charAt(index + 1);
        index += 2;
        continue;
      }
      unescaped += char;
      index += 1;
    }
    name = unescaped;
  } else {
    if (segment.includes('`')) {
      throw fieldPathError(`stray backtick in unquoted segment of field path: "${fullPath}"`);
    }
    name = segment;
  }

  if (name.length === 0) {
    throw fieldPathError(`empty field name in field path: "${fullPath}"`);
  }
  if (RESERVED_FIELD_NAME_PATTERN.test(name)) {
    throw fieldPathError(`reserved field name is not allowed in a field path: "${name}"`);
  }
  return name;
}

/**
 * Parses a caller-supplied Firestore field path into decoded segment names.
 * Validates the grammar and throws `FirestoreCodecError` on malformed input
 * (empty path, empty segment `a..b`, unterminated quotes, reserved `__x__`).
 * Segments that merely need quoting (`unit price`, `1abc`) parse successfully;
 * `encodeFieldPath` then quotes them.
 */
export function parseFieldPath(path: string): string[] {
  if (typeof path !== 'string' || path.length === 0) {
    throw fieldPathError('field path must be a non-empty string');
  }

  const rawSegments: string[] = [];
  let current = '';
  let index = 0;
  let inQuotes = false;
  while (index < path.length) {
    const char = path.charAt(index);
    if (inQuotes) {
      if (char === '\\') {
        if (index + 1 >= path.length) {
          throw fieldPathError(`dangling escape in field path: "${path}"`);
        }
        current += char + path.charAt(index + 1);
        index += 2;
        continue;
      }
      if (char === '`') {
        inQuotes = false;
      }
      current += char;
      index += 1;
      continue;
    }
    if (char === '`') {
      inQuotes = true;
      current += char;
      index += 1;
      continue;
    }
    if (char === '.') {
      rawSegments.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  if (inQuotes) {
    throw fieldPathError(`unterminated quoted segment in field path: "${path}"`);
  }
  rawSegments.push(current);

  return rawSegments.map((segment) => decodeFieldPathSegment(segment, path));
}

/**
 * Encodes ONE field name for the Firestore REST wire: simple names pass
 * unchanged; anything else is backtick-quoted with `\` and `` ` `` escaped
 * (the exact grammar the emulator enforces â€” see `parseFieldPath`).
 */
export function encodeFieldPathSegment(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw fieldPathError('field name must be a non-empty string');
  }
  if (RESERVED_FIELD_NAME_PATTERN.test(name)) {
    throw fieldPathError(`reserved field name is not allowed in a field path: "${name}"`);
  }
  if (SIMPLE_FIELD_NAME_PATTERN.test(name)) {
    return name;
  }
  return '`' + name.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

/** Parses `path` and re-encodes it into canonical Firestore field-path syntax. */
export function encodeFieldPath(path: string): string {
  return parseFieldPath(path).map(encodeFieldPathSegment).join('.');
}

/** Joins already-decoded segment names into a canonical wire field path. */
export function encodeFieldPathSegments(segments: readonly string[]): string {
  if (segments.length === 0) {
    throw fieldPathError('field path must contain at least one segment');
  }
  return segments.map(encodeFieldPathSegment).join('.');
}

// ---------------------------------------------------------------------------
// Server-timestamp extraction (split caller data before a commit is built).
// ---------------------------------------------------------------------------

/** Result of splitting caller data into ordinary fields + transform targets. */
export interface ExtractedServerTimestamps {
  /** Ordinary data with every `SERVER_TIMESTAMP` marker removed. */
  readonly fields: Record<string, unknown>;
  /** Decoded segment paths of the fields that must become `REQUEST_TIME` transforms. */
  readonly transformPaths: readonly (readonly string[])[];
}

function containsServerTimestamp(value: unknown): boolean {
  if (isServerTimestamp(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsServerTimestamp(item));
  }
  if (isPlainObject(value)) {
    return Object.values(value).some((item) => containsServerTimestamp(item));
  }
  return false;
}

/**
 * Walks caller data and separates `SERVER_TIMESTAMP` markers from ordinary
 * values. Markers nested inside plain maps become nested transform paths
 * (e.g. `meta.at`); markers anywhere inside an array throw, because a Firestore
 * field transform cannot target an array element.
 *
 * Empty parent objects left behind by the extraction are intentionally KEPT in
 * `fields` (e.g. `{ meta: { at: SERVER_TIMESTAMP } }` -> `fields: { meta: {} }`),
 * which is exactly the input shape the emulator accepts alongside a transform.
 */
export function extractServerTimestamps(data: Record<string, unknown>): ExtractedServerTimestamps {
  const fields: Record<string, unknown> = {};
  const transformPaths: string[][] = [];

  const walk = (source: Record<string, unknown>, target: Record<string, unknown>, path: readonly string[]): void => {
    for (const [key, value] of Object.entries(source)) {
      if (isServerTimestamp(value)) {
        transformPaths.push([...path, key]);
        continue;
      }
      if (Array.isArray(value)) {
        if (containsServerTimestamp(value)) {
          throw new FirestoreCodecError(
            `SERVER_TIMESTAMP cannot appear inside an array (field "${[...path, key].join('.')}"): `
            + 'a Firestore field transform cannot target an array element',
          );
        }
        target[key] = value;
        continue;
      }
      if (isPlainObject(value)) {
        const nested: Record<string, unknown> = {};
        walk(value, nested, [...path, key]);
        target[key] = nested;
        continue;
      }
      target[key] = value;
    }
  };

  walk(data, fields, []);
  return { fields, transformPaths };
}



