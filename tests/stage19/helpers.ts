import { createManagerApplication } from '../../electron/application';
import type { StockLog } from '../../electron/domain/models';
import type { StockLogsRepository } from '../../electron/repositories/contracts/order-repository';
import { FakeSession, FakeOrdersRepository, timestamp } from '../stage7/helpers/fakes';

export class RecordingStockLogsRepository implements StockLogsRepository {
  public readonly allLimits: number[] = [];
  public readonly orderQueries: { readonly orderId: string; readonly limit: number }[] = [];

  public constructor(
    public readonly logs: readonly StockLog[] = [],
    private readonly failure: Error | null = null,
  ) {}

  public async listStockLogs(limit: number): Promise<readonly StockLog[]> {
    this.allLimits.push(limit);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.logs;
  }

  public async listStockLogsByOrder(orderId: string, limit: number): Promise<readonly StockLog[]> {
    this.allLimits.push(limit);
    this.orderQueries.push({ orderId, limit });
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.logs.filter((entry) => entry.orderId === orderId);
  }
}

export function stockLog(overrides: Partial<StockLog> = {}): StockLog {
  return {
    id: 'log-1',
    medicineId: 'med-42',
    medicineName: 'باراسيتامول',
    quantity: 7,
    type: 'outward',
    date: timestamp('2026-06-04T08:30:00.000Z'),
    label: 'صرف طلب Allison',
    actorUid: 'uid-employee',
    requestId: 'req-9',
    orderId: 'ord-3',
    ...overrides,
  };
}

export function createTestApplication(
  repository: RecordingStockLogsRepository,
  session = FakeSession.signedIn(),
): ReturnType<typeof createManagerApplication> {
  return createManagerApplication({
    session,
    usersRepository: undefined as never,
    medicinesRepository: undefined as never,
    settingsRepository: undefined as never,
    orderRequestsRepository: undefined as never,
    ordersRepository: new FakeOrdersRepository([]),
    stockLogsRepository: repository,
    inboundStockTransactionFactory: undefined as never,
    orderProcessing: undefined as never,
  });
}
