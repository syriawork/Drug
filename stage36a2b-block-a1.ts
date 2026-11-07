
describe('Stage 36A2B orderRequest schema extension', () => {
  function makeOrderOperation(operationId = 'journal:operation-order-1'): OperationIdentity {
    return createOperationIdentity(operationId, 'reserve', {
      orderId: 'stable-request-1',
      userId: 'uid-employee',
      items: [{ medicineId: 'medicine-1', quantity: 2 }],
    });
  }

  function orderIntent(overrides?: {
    readonly requestId?: string;
    readonly uid?: string;
    readonly requestedItems?: readonly { readonly medicineId: string; readonly quantity: number }[];
  }): { readonly requestId: string; readonly uid: string; readonly requestedItems: readonly { readonly medicineId: string; readonly quantity: number }[] } {
    return Object.freeze({
      requestId: 'stable-request-1',
      uid: 'uid-employee',
      requestedItems: Object.freeze([Object.freeze({ medicineId: 'medicine-1', quantity: 2 })]),
      ...overrides,
    });
  }

  function expectJournalError(fn: () => unknown, substring: string): void {
    let caught: unknown;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof OperationJournalError, `expected OperationJournalError: ${substring}`);
    assert.match((caught as Error).message, new RegExp(substring));
  }

  function expectInvalidOrderRequest(operation: OperationIdentity, orderRequest: unknown, substring: string): void {
    expectJournalError(
      () => createOperationJournalRecord(operation, 'prepared', {}, orderRequest as JournalOrderRequest),
      substring,
    );
  }
