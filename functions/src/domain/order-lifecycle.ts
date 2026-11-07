import {
  DomainValidationError,
  isDomainId,
} from './operations';

export type DomainOrderStatus = 'pending' | 'accepted' | 'rejected' | 'fulfilled' | 'cancelled';

export interface OrderLine {
  readonly medicineId: string;
  readonly quantity: number;
}

export interface PhysicalReturnEvidence {
  readonly returnEventId: string;
  readonly orderId: string;
  readonly items: readonly OrderLine[];
  readonly acceptedByUid: string;
  readonly acceptedAt: string;
}

export interface OrderTransitionContext {
  readonly orderId: string;
  readonly items: readonly OrderLine[];
}

export interface OrderTransitionEvidence {
  readonly physicalReturn?: PhysicalReturnEvidence;
}

const ORDER_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'accepted',
  'rejected',
  'fulfilled',
  'cancelled',
]);

const ALLOWED_TRANSITIONS: Readonly<Record<DomainOrderStatus, ReadonlySet<DomainOrderStatus>>> = {
  pending: new Set(['accepted', 'rejected', 'cancelled']),
  accepted: new Set(['fulfilled', 'cancelled']),
  rejected: new Set(),
  fulfilled: new Set(['cancelled']),
  cancelled: new Set(),
};

function isOrderStatus(value: unknown): value is DomainOrderStatus {
  return typeof value === 'string' && ORDER_STATUSES.has(value);
}

function invalid(code: string, message: string): never {
  throw new DomainValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, fields: readonly string[], code: string, label: string): void {
  const expected = new Set(fields);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !expected.has(key))) {
    invalid(code, `${label} contains an unknown field.`);
  }
}

function parseLines(value: unknown, label: string): Map<string, number> {
  if (!Array.isArray(value) || value.length === 0) {
    return invalid('INVALID_RETURN_EVIDENCE', `${label} must contain at least one item.`);
  }
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (!isRecord(item)) {
      return invalid('INVALID_RETURN_EVIDENCE', `${label} contains a malformed item.`);
    }
    exactFields(item, ['medicineId', 'quantity'], 'INVALID_RETURN_EVIDENCE', label);
    if (!isDomainId(item['medicineId'])) {
      invalid('INVALID_RETURN_EVIDENCE', `${label} contains an invalid medicine ID.`);
    }
    if (typeof item['quantity'] !== 'number' || !Number.isSafeInteger(item['quantity']) || item['quantity'] <= 0) {
      invalid('INVALID_RETURN_EVIDENCE', `${label} quantities must be positive safe integers.`);
    }
    const quantity = (quantities.get(item['medicineId']) ?? 0) + item['quantity'];
    if (!Number.isSafeInteger(quantity)) {
      invalid('INVALID_RETURN_EVIDENCE', `${label} quantity exceeds the safe integer range.`);
    }
    quantities.set(item['medicineId'], quantity);
  }
  return quantities;
}

function validatePhysicalReturnEvidence(
  value: unknown,
  contextValue: unknown,
): PhysicalReturnEvidence {
  if (!isRecord(value)) {
    return invalid('INVALID_RETURN_EVIDENCE', 'Physical return evidence must be an object.');
  }
  exactFields(value, ['returnEventId', 'orderId', 'items', 'acceptedByUid', 'acceptedAt'], 'INVALID_RETURN_EVIDENCE', 'Physical return evidence');
  if (
    !isDomainId(value['returnEventId'])
    || !isDomainId(value['orderId'])
    || !isDomainId(value['acceptedByUid'])
  ) {
    return invalid('INVALID_RETURN_EVIDENCE', 'Return evidence IDs are malformed.');
  }
  if (typeof value['acceptedAt'] !== 'string') {
    return invalid('INVALID_RETURN_EVIDENCE', 'Return acceptance timestamp is required.');
  }
  const timestamp = new Date(value['acceptedAt']);
  if (
    !Number.isFinite(timestamp.getTime())
    || timestamp.toISOString() !== value['acceptedAt']
  ) {
    return invalid('INVALID_RETURN_EVIDENCE', 'Return acceptance timestamp must be canonical UTC ISO format.');
  }

  if (!isRecord(contextValue)) {
    return invalid('INVALID_TRANSITION_CONTEXT', 'Order context is required to validate return evidence.');
  }
  exactFields(contextValue, ['orderId', 'items'], 'INVALID_TRANSITION_CONTEXT', 'Order context');
  if (!isDomainId(contextValue['orderId'])) {
    return invalid('INVALID_TRANSITION_CONTEXT', 'Order context ID is malformed.');
  }
  if (value['orderId'] !== contextValue['orderId']) {
    return invalid('INVALID_RETURN_EVIDENCE', 'Return evidence belongs to a different order.');
  }

  const orderItems = parseLines(contextValue['items'], 'Order context items');
  const returnItems = parseLines(value['items'], 'Physical return items');
  for (const [medicineId, quantity] of returnItems) {
    const orderedQuantity = orderItems.get(medicineId);
    if (orderedQuantity === undefined || quantity > orderedQuantity) {
      invalid('INVALID_RETURN_EVIDENCE', 'Returned medicine and quantity do not match the order.');
    }
  }

  return Object.freeze({
    returnEventId: value['returnEventId'],
    orderId: value['orderId'],
    items: Object.freeze([...returnItems.entries()].map(([medicineId, quantity]) => Object.freeze({
      medicineId,
      quantity,
    }))),
    acceptedByUid: value['acceptedByUid'],
    acceptedAt: value['acceptedAt'],
  });
}

export function validateOrderTransition(
  fromValue: unknown,
  toValue: unknown,
  evidenceValue: unknown = {},
  contextValue?: unknown,
): void {
  if (!isOrderStatus(fromValue) || !isOrderStatus(toValue)) {
    invalid('INVALID_ORDER_STATUS', 'Order transition contains an unsupported status.');
  }
  if (!isRecord(evidenceValue)) {
    invalid('INVALID_TRANSITION_EVIDENCE', 'Order transition evidence must be an object.');
  }
  exactFields(evidenceValue, ['physicalReturn'], 'INVALID_TRANSITION_EVIDENCE', 'Order transition evidence');

  if (!ALLOWED_TRANSITIONS[fromValue].has(toValue)) {
    invalid('INVALID_ORDER_TRANSITION', `Transition from ${fromValue} to ${toValue} is not permitted.`);
  }
  if (fromValue === 'fulfilled' && toValue === 'cancelled') {
    validatePhysicalReturnEvidence(evidenceValue['physicalReturn'], contextValue);
  } else if (evidenceValue['physicalReturn'] !== undefined) {
    invalid('INVALID_TRANSITION_EVIDENCE', 'Physical return evidence is valid only for fulfilled-order cancellation.');
  }
}
