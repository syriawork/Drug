import { createHash } from 'node:crypto';

export type OperationType =
  | 'reserve'
  | 'fulfill'
  | 'release'
  | 'receipt'
  | 'correction'
  | 'reversal';

export interface MedicineLine {
  readonly medicineId: string;
  readonly quantity: number;
}

export interface OrderOperationPayload {
  readonly orderId: string;
  readonly userId: string;
  readonly items: readonly MedicineLine[];
}

export interface ReceiptOperationPayload {
  readonly medicineId: string;
  readonly quantity: number;
}

export interface CorrectionOperationPayload {
  readonly medicineId: string;
  readonly stockPool: 'availableStock' | 'reservedStock';
  readonly delta: number;
}

export interface ReversalOperationPayload {
  readonly sourceMovementId: string;
}

export type CanonicalOperationPayload =
  | OrderOperationPayload
  | ReceiptOperationPayload
  | CorrectionOperationPayload
  | ReversalOperationPayload;

export interface OperationIdentity {
  readonly operationId: string;
  readonly operationType: OperationType;
  readonly canonicalPayload: CanonicalOperationPayload;
  readonly payloadHash: string;
}

export class DomainValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

const OPERATION_TYPES: ReadonlySet<string> = new Set([
  'reserve',
  'fulfill',
  'release',
  'receipt',
  'correction',
  'reversal',
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function isOperationType(value: unknown): value is OperationType {
  return typeof value === 'string' && OPERATION_TYPES.has(value);
}

function invalid(code: string, message: string): never {
  throw new DomainValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const expected = new Set(fields);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !expected.has(key))) {
    invalid('UNKNOWN_FIELD', `${label} contains an unknown field.`);
  }
}

export function assertDomainId(value: unknown, label = 'id'): asserts value is string {
  if (!isDomainId(value)) {
    invalid('INVALID_ID', `${label} must be a non-empty canonical identifier.`);
  }
}

export function isDomainId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    invalid('INVALID_QUANTITY', `${label} must be a positive safe integer.`);
  }
  return value;
}

function signedSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    invalid('INVALID_DELTA', `${label} must be a safe integer.`);
  }
  return value;
}

function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseOrderPayload(value: unknown): OrderOperationPayload {
  if (!isRecord(value)) {
    return invalid('INVALID_PAYLOAD', 'Order operation payload must be an object.');
  }
  exactFields(value, ['orderId', 'userId', 'items'], 'Order operation payload');
  assertDomainId(value['orderId'], 'orderId');
  assertDomainId(value['userId'], 'userId');
  if (!Array.isArray(value['items']) || value['items'].length === 0) {
    return invalid('EMPTY_ORDER', 'An order must contain at least one medicine line.');
  }

  const quantities = new Map<string, number>();
  for (const rawLine of value['items']) {
    if (!isRecord(rawLine)) {
      return invalid('INVALID_ORDER_LINE', 'Each order line must be an object.');
    }
    exactFields(rawLine, ['medicineId', 'quantity'], 'Order line');
    assertDomainId(rawLine['medicineId'], 'medicineId');
    const quantity = positiveSafeInteger(rawLine['quantity'], 'quantity');
    const next = (quantities.get(rawLine['medicineId']) ?? 0) + quantity;
    if (!Number.isSafeInteger(next)) {
      return invalid('ARITHMETIC_OVERFLOW', 'Aggregated medicine quantity exceeds the safe integer range.');
    }
    quantities.set(rawLine['medicineId'], next);
  }

  const items = [...quantities.entries()]
    .sort(([left], [right]) => compareIdentifiers(left, right))
    .map(([medicineId, quantity]) => Object.freeze({ medicineId, quantity }));
  return Object.freeze({
    orderId: value['orderId'],
    userId: value['userId'],
    items: Object.freeze(items),
  });
}

function parseOperationType(value: unknown): OperationType {
  if (!isOperationType(value)) {
    return invalid('INVALID_OPERATION_TYPE', 'The operation type is not supported.');
  }
  return value;
}

export function canonicalizeOperationPayload(
  operationTypeInput: unknown,
  payload: unknown,
): { readonly operationType: OperationType; readonly payload: CanonicalOperationPayload } {
  const operationType = parseOperationType(operationTypeInput);
  if (operationType === 'reserve' || operationType === 'fulfill' || operationType === 'release') {
    return Object.freeze({ operationType, payload: parseOrderPayload(payload) });
  }
  if (!isRecord(payload)) {
    return invalid('INVALID_PAYLOAD', 'Operation payload must be an object.');
  }

  if (operationType === 'receipt') {
    exactFields(payload, ['medicineId', 'quantity'], 'Receipt payload');
    assertDomainId(payload['medicineId'], 'medicineId');
    return Object.freeze({
      operationType,
      payload: Object.freeze({
        medicineId: payload['medicineId'],
        quantity: positiveSafeInteger(payload['quantity'], 'quantity'),
      }),
    });
  }

  if (operationType === 'correction') {
    exactFields(payload, ['medicineId', 'stockPool', 'delta'], 'Correction payload');
    assertDomainId(payload['medicineId'], 'medicineId');
    const stockPool = payload['stockPool'];
    if (stockPool !== 'availableStock' && stockPool !== 'reservedStock') {
      return invalid('INVALID_STOCK_POOL', 'Correction must identify exactly one supported stock pool.');
    }
    const delta = signedSafeInteger(payload['delta'], 'delta');
    if (delta === 0) {
      return invalid('INVALID_DELTA', 'A correction delta cannot be zero.');
    }
    return Object.freeze({
      operationType,
      payload: Object.freeze({ medicineId: payload['medicineId'], stockPool, delta }),
    });
  }

  exactFields(payload, ['sourceMovementId'], 'Reversal payload');
  assertDomainId(payload['sourceMovementId'], 'sourceMovementId');
  return Object.freeze({
    operationType,
    payload: Object.freeze({ sourceMovementId: payload['sourceMovementId'] }),
  });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort(compareIdentifiers)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${fields.join(',')}}`;
}

function operationPayloadHash(operationType: OperationType, payload: CanonicalOperationPayload): string {
  return createHash('sha256')
    .update(stableJson({ operationType, payload }), 'utf8')
    .digest('hex');
}

export function hashOperationPayload(
  operationTypeInput: unknown,
  payload: unknown,
): string {
  const canonical = canonicalizeOperationPayload(operationTypeInput, payload);
  return operationPayloadHash(canonical.operationType, canonical.payload);
}

export function validateStoredOperationRecord(value: unknown): OperationIdentity {
  if (!isRecord(value)) {
    return invalid('INVALID_STORED_OPERATION', 'Stored operation record must be an object.');
  }
  exactFields(value, ['operationId', 'operationType', 'canonicalPayload', 'payloadHash'], 'Stored operation record');
  if (
    !Object.hasOwn(value, 'operationId')
    || !Object.hasOwn(value, 'operationType')
    || !Object.hasOwn(value, 'canonicalPayload')
    || !Object.hasOwn(value, 'payloadHash')
  ) {
    return invalid('INVALID_STORED_OPERATION', 'Stored operation record is incomplete.');
  }
  assertDomainId(value['operationId'], 'operationId');
  const operationType = parseOperationType(value['operationType']);
  if (typeof value['payloadHash'] !== 'string' || !HASH_PATTERN.test(value['payloadHash'])) {
    return invalid('INVALID_STORED_OPERATION', 'Stored operation hash must be lowercase SHA-256 hex.');
  }

  const canonical = canonicalizeOperationPayload(operationType, value['canonicalPayload']);
  if (stableJson(value['canonicalPayload']) !== stableJson(canonical.payload)) {
    return invalid('INVALID_STORED_OPERATION', 'Stored operation payload is not in canonical form.');
  }
  const expectedHash = operationPayloadHash(operationType, canonical.payload);
  if (value['payloadHash'] !== expectedHash) {
    return invalid('STORED_OPERATION_HASH_MISMATCH', 'Stored operation payload does not match its hash.');
  }

  return Object.freeze({
    operationId: value['operationId'],
    operationType,
    canonicalPayload: canonical.payload,
    payloadHash: expectedHash,
  });
}

export function createOperationIdentity(
  operationId: unknown,
  operationType: unknown,
  payload: unknown,
): OperationIdentity {
  assertDomainId(operationId, 'operationId');
  const canonical = canonicalizeOperationPayload(operationType, payload);
  return Object.freeze({
    operationId,
    operationType: canonical.operationType,
    canonicalPayload: canonical.payload,
    payloadHash: operationPayloadHash(canonical.operationType, canonical.payload),
  });
}

export function assertOperationIdentityCompatible(
  existingValue: unknown,
  proposedValue: unknown,
): void {
  const existing = validateStoredOperationRecord(existingValue);
  const proposed = validateStoredOperationRecord(proposedValue);
  if (existing.operationId !== proposed.operationId) {
    invalid('OPERATION_ID_MISMATCH', 'The stored operation identity does not match the requested operation ID.');
  }
  if (
    existing.operationType !== proposed.operationType
    || existing.payloadHash !== proposed.payloadHash
    || stableJson(existing.canonicalPayload) !== stableJson(proposed.canonicalPayload)
  ) {
    invalid('OPERATION_ID_CONFLICT', 'An operation ID cannot be reused with a different type or payload.');
  }
}
