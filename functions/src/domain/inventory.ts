import {
  assertDomainId,
  DomainValidationError,
} from './operations';

export interface InventoryState {
  readonly availableStock: number;
  readonly reservedStock: number;
}

export interface InventoryDeltas {
  readonly availableStock: number;
  readonly reservedStock: number;
  readonly onHand: number;
}

interface MovementBase {
  readonly movementId: string;
  readonly operationId: string;
  readonly medicineId: string;
  readonly before: InventoryState;
  readonly after: InventoryState;
  readonly deltas: InventoryDeltas;
}

export type InventoryMovement =
  | (MovementBase & {
    readonly operationType: 'reserve' | 'fulfill' | 'release' | 'receipt';
    readonly quantity: number;
  })
  | (MovementBase & {
    readonly operationType: 'correction';
    readonly stockPool: 'availableStock' | 'reservedStock';
    readonly delta: number;
  })
  | (MovementBase & {
    readonly operationType: 'reversal';
    readonly sourceMovementId: string;
    readonly sourceOperationId: string;
  });

export type InventoryCommand =
  | { readonly operationType: 'reserve' | 'fulfill' | 'release' | 'receipt'; readonly medicineId: string; readonly quantity: number }
  | { readonly operationType: 'correction'; readonly medicineId: string; readonly stockPool: 'availableStock' | 'reservedStock'; readonly delta: number };

export interface ReversalGuardState {
  readonly sourceMovementId: string;
  readonly reversalExists: boolean;
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
    invalid('INVALID_INVENTORY_STATE', `${label} contains an unknown field.`);
  }
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    invalid('INVALID_INVENTORY_STATE', `${label} must be a safe integer.`);
  }
  return value;
}

function nonnegativeBalance(value: unknown, label: string): number {
  const balance = safeInteger(value, label);
  if (balance < 0) {
    invalid('INVALID_INVENTORY_STATE', `${label} cannot be negative.`);
  }
  return balance;
}

export function validateInventoryState(value: unknown): InventoryState {
  if (!isRecord(value)) {
    return invalid('INVALID_INVENTORY_STATE', 'Inventory state must be an object.');
  }
  exactFields(value, ['availableStock', 'reservedStock'], 'Inventory state');
  if (!Object.hasOwn(value, 'availableStock') || !Object.hasOwn(value, 'reservedStock')) {
    return invalid('INVALID_INVENTORY_STATE', 'Inventory state requires both stock balances.');
  }
  const state = {
    availableStock: nonnegativeBalance(value['availableStock'], 'availableStock'),
    reservedStock: nonnegativeBalance(value['reservedStock'], 'reservedStock'),
  };
  if (!Number.isSafeInteger(state.availableStock + state.reservedStock)) {
    invalid('ARITHMETIC_OVERFLOW', 'The derived on-hand balance exceeds the safe integer range.');
  }
  return Object.freeze(state);
}

export function onHand(stateValue: unknown): number {
  const state = validateInventoryState(stateValue);
  return state.availableStock + state.reservedStock;
}

function commandNumber(value: unknown, label: string, positive: boolean): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || (positive ? value <= 0 : value === 0)
  ) {
    invalid(
      positive ? 'INVALID_QUANTITY' : 'INVALID_DELTA',
      `${label} must be a ${positive ? 'positive ' : 'non-zero '}safe integer.`,
    );
  }
  return value;
}

function parseCommand(value: unknown): InventoryCommand {
  if (!isRecord(value) || typeof value['operationType'] !== 'string') {
    return invalid('INVALID_OPERATION_TYPE', 'Inventory command is malformed.');
  }
  assertDomainId(value['medicineId'], 'medicineId');
  const operationType = value['operationType'];
  if (
    operationType === 'reserve'
    || operationType === 'fulfill'
    || operationType === 'release'
    || operationType === 'receipt'
  ) {
    exactFields(value, ['operationType', 'medicineId', 'quantity'], 'Inventory command');
    return Object.freeze({
      operationType,
      medicineId: value['medicineId'],
      quantity: commandNumber(value['quantity'], 'quantity', true),
    });
  }
  if (operationType === 'correction') {
    exactFields(value, ['operationType', 'medicineId', 'stockPool', 'delta'], 'Inventory command');
    const stockPool = value['stockPool'];
    if (stockPool !== 'availableStock' && stockPool !== 'reservedStock') {
      return invalid('INVALID_STOCK_POOL', 'Correction must identify exactly one supported stock pool.');
    }
    return Object.freeze({
      operationType,
      medicineId: value['medicineId'],
      stockPool,
      delta: commandNumber(value['delta'], 'delta', false),
    });
  }
  return invalid('INVALID_OPERATION_TYPE', 'This operation cannot be applied as an inventory command.');
}

function addBalance(balance: number, delta: number, label: string): number {
  const result = balance + delta;
  if (!Number.isSafeInteger(result)) {
    invalid('ARITHMETIC_OVERFLOW', `${label} exceeds the safe integer range.`);
  }
  if (result < 0) {
    invalid('NEGATIVE_BALANCE', `${label} cannot become negative.`);
  }
  return result;
}

function checkedDeltas(before: InventoryState, after: InventoryState): InventoryDeltas {
  const availableStock = after.availableStock - before.availableStock;
  const reservedStock = after.reservedStock - before.reservedStock;
  const onHandDelta = availableStock + reservedStock;
  if (![availableStock, reservedStock, onHandDelta].every(Number.isSafeInteger)) {
    invalid('ARITHMETIC_OVERFLOW', 'Inventory movement delta exceeds the safe integer range.');
  }
  return Object.freeze({ availableStock, reservedStock, onHand: onHandDelta });
}

function makeMovement(
  movementId: string,
  operationId: string,
  command: InventoryCommand,
  before: InventoryState,
  after: InventoryState,
): InventoryMovement {
  const base = {
    movementId,
    operationId,
    medicineId: command.medicineId,
    before,
    after,
    deltas: checkedDeltas(before, after),
  };
  if (command.operationType === 'correction') {
    return Object.freeze({
      ...base,
      operationType: command.operationType,
      stockPool: command.stockPool,
      delta: command.delta,
    });
  }
  return Object.freeze({
    ...base,
    operationType: command.operationType,
    quantity: command.quantity,
  });
}

export function calculateInventoryMovement(
  stateValue: unknown,
  operationIdValue: unknown,
  movementIdValue: unknown,
  commandValue: unknown,
): InventoryMovement {
  const before = validateInventoryState(stateValue);
  assertDomainId(operationIdValue, 'operationId');
  assertDomainId(movementIdValue, 'movementId');
  const command = parseCommand(commandValue);
  const { availableStock, reservedStock } = before;
  let after: InventoryState;

  switch (command.operationType) {
    case 'reserve':
      if (availableStock < command.quantity) {
        invalid('INSUFFICIENT_AVAILABLE_STOCK', 'Available stock is insufficient for this reservation.');
      }
      after = {
        availableStock: addBalance(availableStock, -command.quantity, 'availableStock'),
        reservedStock: addBalance(reservedStock, command.quantity, 'reservedStock'),
      };
      break;
    case 'fulfill':
      if (reservedStock < command.quantity) {
        invalid('INSUFFICIENT_RESERVED_STOCK', 'Reserved stock is insufficient for fulfillment.');
      }
      after = { availableStock, reservedStock: addBalance(reservedStock, -command.quantity, 'reservedStock') };
      break;
    case 'release':
      if (reservedStock < command.quantity) {
        invalid('INSUFFICIENT_RESERVED_STOCK', 'Reserved stock is insufficient for release.');
      }
      after = {
        availableStock: addBalance(availableStock, command.quantity, 'availableStock'),
        reservedStock: addBalance(reservedStock, -command.quantity, 'reservedStock'),
      };
      break;
    case 'receipt':
      after = { availableStock: addBalance(availableStock, command.quantity, 'availableStock'), reservedStock };
      break;
    case 'correction':
      after = command.stockPool === 'availableStock'
        ? { availableStock: addBalance(availableStock, command.delta, 'availableStock'), reservedStock }
        : { availableStock, reservedStock: addBalance(reservedStock, command.delta, 'reservedStock') };
      break;
  }

  return makeMovement(movementIdValue, operationIdValue, command, before, validateInventoryState(after));
}

function validateMovementBase(value: Record<string, unknown>): {
  readonly movementId: string;
  readonly operationId: string;
  readonly medicineId: string;
  readonly before: InventoryState;
  readonly after: InventoryState;
  readonly deltas: InventoryDeltas;
} {
  assertDomainId(value['movementId'], 'movementId');
  assertDomainId(value['operationId'], 'operationId');
  assertDomainId(value['medicineId'], 'medicineId');
  const before = validateInventoryState(value['before']);
  const after = validateInventoryState(value['after']);
  if (!isRecord(value['deltas'])) {
    return invalid('INVALID_MOVEMENT', 'Inventory movement deltas are malformed.');
  }
  exactFields(value['deltas'], ['availableStock', 'reservedStock', 'onHand'], 'Inventory movement deltas');
  const deltas = {
    availableStock: safeInteger(value['deltas']['availableStock'], 'availableStock delta'),
    reservedStock: safeInteger(value['deltas']['reservedStock'], 'reservedStock delta'),
    onHand: safeInteger(value['deltas']['onHand'], 'onHand delta'),
  };
  const calculated = checkedDeltas(before, after);
  if (
    calculated.availableStock !== deltas.availableStock
    || calculated.reservedStock !== deltas.reservedStock
    || calculated.onHand !== deltas.onHand
  ) {
    return invalid('INVALID_MOVEMENT', 'Inventory movement deltas do not match its before and after balances.');
  }
  return {
    movementId: value['movementId'],
    operationId: value['operationId'],
    medicineId: value['medicineId'],
    before,
    after,
    deltas: Object.freeze(deltas),
  };
}

export function validateInventoryMovement(
  value: unknown,
  reversalSourceValue?: unknown,
): InventoryMovement {
  if (!isRecord(value) || typeof value['operationType'] !== 'string') {
    return invalid('INVALID_MOVEMENT', 'Inventory movement must be a typed object.');
  }
  const operationType = value['operationType'];

  if (
    operationType === 'reserve'
    || operationType === 'fulfill'
    || operationType === 'release'
    || operationType === 'receipt'
  ) {
    exactFields(value, [
      'movementId', 'operationId', 'operationType', 'medicineId', 'quantity', 'before', 'after', 'deltas',
    ], 'Inventory movement');
    const base = validateMovementBase(value);
    const quantity = commandNumber(value['quantity'], 'quantity', true);
    const { availableStock, reservedStock, onHand: onHandDelta } = base.deltas;
    const valid =
      (operationType === 'reserve' && availableStock === -quantity && reservedStock === quantity && onHandDelta === 0)
      || (operationType === 'fulfill' && availableStock === 0 && reservedStock === -quantity && onHandDelta === -quantity)
      || (operationType === 'release' && availableStock === quantity && reservedStock === -quantity && onHandDelta === 0)
      || (operationType === 'receipt' && availableStock === quantity && reservedStock === 0 && onHandDelta === quantity);
    if (!valid) {
      invalid('INVALID_MOVEMENT_SEMANTICS', `Movement deltas do not match ${operationType} semantics.`);
    }
    return Object.freeze({ ...base, operationType, quantity });
  }

  if (operationType === 'correction') {
    exactFields(value, [
      'movementId', 'operationId', 'operationType', 'medicineId', 'stockPool', 'delta', 'before', 'after', 'deltas',
    ], 'Inventory movement');
    const base = validateMovementBase(value);
    const stockPool = value['stockPool'];
    if (stockPool !== 'availableStock' && stockPool !== 'reservedStock') {
      return invalid('INVALID_STOCK_POOL', 'Correction movement must identify exactly one stock pool.');
    }
    const delta = commandNumber(value['delta'], 'delta', false);
    const valid = stockPool === 'availableStock'
      ? base.deltas.availableStock === delta && base.deltas.reservedStock === 0 && base.deltas.onHand === delta
      : base.deltas.availableStock === 0 && base.deltas.reservedStock === delta && base.deltas.onHand === delta;
    if (!valid) {
      invalid('INVALID_MOVEMENT_SEMANTICS', 'Correction movement delta does not match its identified stock pool.');
    }
    return Object.freeze({ ...base, operationType, stockPool, delta });
  }

  if (operationType === 'reversal') {
    exactFields(value, [
      'movementId', 'operationId', 'operationType', 'medicineId', 'sourceMovementId', 'sourceOperationId',
      'before', 'after', 'deltas',
    ], 'Inventory movement');
    const base = validateMovementBase(value);
    assertDomainId(value['sourceMovementId'], 'sourceMovementId');
    assertDomainId(value['sourceOperationId'], 'sourceOperationId');
    if (reversalSourceValue === undefined) {
      return invalid('MISSING_REVERSAL_SOURCE', 'A reversal must be validated against its source movement.');
    }
    const source = validateInventoryMovement(reversalSourceValue);
    if (source.operationType === 'reversal') {
      return invalid('REVERSAL_OF_REVERSAL', 'A reversal cannot reverse another reversal.');
    }
    if (
      value['sourceMovementId'] !== source.movementId
      || value['sourceOperationId'] !== source.operationId
      || base.medicineId !== source.medicineId
      || base.operationId === source.operationId
      || base.movementId === source.movementId
      || base.deltas.availableStock !== -source.deltas.availableStock
      || base.deltas.reservedStock !== -source.deltas.reservedStock
      || base.deltas.onHand !== -source.deltas.onHand
    ) {
      return invalid('INVALID_REVERSAL', 'Reversal movement is not the exact inverse of its source movement.');
    }
    return Object.freeze({
      ...base,
      operationType,
      sourceMovementId: source.movementId,
      sourceOperationId: source.operationId,
    });
  }

  return invalid('INVALID_MOVEMENT', 'Inventory movement has an unsupported operation type.');
}

function validateReversalGuard(value: unknown, expectedSourceMovementId: string): ReversalGuardState {
  if (!isRecord(value)) {
    return invalid('INVALID_REVERSAL_GUARD', 'An authoritative reversal guard state is required.');
  }
  exactFields(value, ['sourceMovementId', 'reversalExists'], 'Reversal guard');
  assertDomainId(value['sourceMovementId'], 'sourceMovementId');
  if (value['sourceMovementId'] !== expectedSourceMovementId || typeof value['reversalExists'] !== 'boolean') {
    return invalid('INVALID_REVERSAL_GUARD', 'Reversal guard state is malformed or refers to another source.');
  }
  return Object.freeze({ sourceMovementId: value['sourceMovementId'], reversalExists: value['reversalExists'] });
}

export function reverseInventoryMovement(
  stateValue: unknown,
  operationIdValue: unknown,
  movementIdValue: unknown,
  originalMovementValue: unknown,
  guardValue: unknown,
): InventoryMovement {
  const state = validateInventoryState(stateValue);
  assertDomainId(operationIdValue, 'operationId');
  assertDomainId(movementIdValue, 'movementId');
  if (isRecord(originalMovementValue) && originalMovementValue['operationType'] === 'reversal') {
    invalid('REVERSAL_OF_REVERSAL', 'A reversal cannot itself be reversed.');
  }
  const source = validateInventoryMovement(originalMovementValue);
  if (source.operationType === 'reversal') {
    invalid('REVERSAL_OF_REVERSAL', 'A reversal cannot itself be reversed.');
  }
  const guard = validateReversalGuard(guardValue, source.movementId);
  if (guard.reversalExists) {
    invalid('DUPLICATE_REVERSAL', 'The authoritative reversal guard already exists for this source movement.');
  }

  const after = validateInventoryState({
    availableStock: addBalance(state.availableStock, -source.deltas.availableStock, 'availableStock'),
    reservedStock: addBalance(state.reservedStock, -source.deltas.reservedStock, 'reservedStock'),
  });
  const reversal: InventoryMovement = Object.freeze({
    movementId: movementIdValue,
    operationId: operationIdValue,
    operationType: 'reversal',
    medicineId: source.medicineId,
    sourceMovementId: source.movementId,
    sourceOperationId: source.operationId,
    before: state,
    after,
    deltas: checkedDeltas(state, after),
  });
  return validateInventoryMovement(reversal, source);
}
