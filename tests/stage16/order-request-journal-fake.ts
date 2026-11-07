import { createOperationIdentity } from '../../functions/src/domain/operations';
import type { OrderRequestIdentityFactory, OrderRequestJournal } from '../../electron/application';
import {
  createOperationJournalRecord,
  type OperationJournalRecord,
} from '../../electron/journal/operation-journal';

export class MemoryOrderRequestJournal implements OrderRequestJournal {
  private readonly records = new Map<string, OperationJournalRecord>();

  public constructor(private readonly events?: string[]) {}

  public async prepare(
    operation: OperationJournalRecord['operation'],
    orderRequest: Omit<NonNullable<OperationJournalRecord['orderRequest']>, 'payload'>,
  ): Promise<OperationJournalRecord> {
    const current = this.records.get(operation.operationId);
    if (current) {
      return current;
    }
    const record = createOperationJournalRecord(operation, 'prepared', {}, {
      ...orderRequest,
      payload: null,
    });
    this.records.set(operation.operationId, record);
    this.events?.push(`journal:prepare:${operation.operationId}:${orderRequest.requestId}`);
    return record;
  }

  public async get(operationId: unknown): Promise<OperationJournalRecord | null> {
    return typeof operationId === 'string' ? this.records.get(operationId) ?? null : null;
  }

  public async listRecords(): Promise<readonly OperationJournalRecord[]> {
    return [...this.records.values()];
  }

  public async setOrderRequestPayload(
    operationId: unknown,
    items: Parameters<OrderRequestJournal['setOrderRequestPayload']>[1],
  ): Promise<OperationJournalRecord> {
    const current = await this.requireRecord(operationId);
    const orderRequest = current.orderRequest;
    if (orderRequest === undefined) {
      throw new Error('test journal record has no order request');
    }
    const updated = createOperationJournalRecord(current.operation, current.lifecycle.status, current.lifecycle, {
      ...orderRequest,
      payload: {
        uid: orderRequest.uid,
        items,
        status: 'pending',
        requestDate: 'SERVER_TIMESTAMP',
      },
    });
    this.records.set(current.operation.operationId, updated);
    this.events?.push('journal:payload');
    return updated;
  }

  public async setStatus(
    operationId: unknown,
    status: OperationJournalRecord['lifecycle']['status'],
    updates: Parameters<OrderRequestJournal['setStatus']>[2] = {},
  ): Promise<OperationJournalRecord> {
    const current = await this.requireRecord(operationId);
    const updated = createOperationJournalRecord(
      current.operation,
      status,
      { ...current.lifecycle, ...updates },
      current.orderRequest,
    );
    this.records.set(current.operation.operationId, updated);
    this.events?.push(`journal:status:${status}`);
    return updated;
  }

  private async requireRecord(operationId: unknown): Promise<OperationJournalRecord> {
    const record = await this.get(operationId);
    if (record === null) {
      throw new Error('test journal record was not found');
    }
    return record;
  }
}

export function createStage36a2IdentityFactory(): OrderRequestIdentityFactory {
  let next = 0;
  return (uid, items) => {
    next += 1;
    const requestId = `req-generated-stage16-${next}`;
    return {
      operation: createOperationIdentity(`stage36a2:operation-${next}`, 'reserve', {
        orderId: requestId,
        userId: uid,
        items,
      }),
      requestId,
    };
  };
}
