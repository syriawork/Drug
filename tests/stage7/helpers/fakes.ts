/**
 * Shared fakes for the Stage 7 tests.
 *
 * Every fake here is a RECORD of what was asked of it, so a test can assert what
 * the application layer called AND - just as importantly - what it did not call.
 * A fake that silently succeeded would let a test pass while the production path
 * did something else entirely.
 *
 * No fake opens a socket, reads a file or starts Electron. The whole Stage 7
 * suite is `node --test` over plain objects.
 */

import { DomainError, type DomainErrorKind } from '../../../electron/domain/errors';
import type { AppSettings, Medicine, Order, OrderItem, OrderRequest, OrderRequestStatus, StockLog, User } from '../../../electron/domain/models';
import type { NewInboundStockMovement } from '../../../electron/repositories/contracts/common';
import { FirestoreTimestamp } from '../../../electron/services/firestore-codec';
import type {
  OrderProcessingActor,
  OrderProcessingOutcome,
  OrderProcessingService,
} from '../../../electron/services/order-processing.service';

/** Builds a domain timestamp through the public codec factory. */
export function timestamp(isoValue: string): FirestoreTimestamp {
  return FirestoreTimestamp.parse(isoValue);
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    uid: 'uid-admin',
    name: 'Nour',
    employeeId: 'E-1',
    role: 'admin',
    status: 'approved',
    hasException: false,
    lastOrderId: 'order-1',
    lastOrderDate: timestamp('2026-06-01T08:00:00.000Z'),
    lastOrderMonthYear: '06-2026',
    lastOrderStatus: 'pending',
    lastOrderIsException: false,
    ...overrides,
  };
}

export function makeMedicine(overrides: Partial<Medicine> = {}): Medicine {
  return {
    id: 'med-1',
    name: 'Panadol',
    maxQuantity: 5,
    stock: 20,
    totalInward: 40,
    totalOutward: 20,
    ...overrides,
  };
}

export function makeOrderRequest(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    id: 'req-1',
    uid: 'uid-emp',
    items: [{ medicineId: 'med-1', medicineName: 'Panadol', quantity: 2 }],
    status: 'pending',
    requestDate: timestamp('2026-06-03T08:00:00.000Z'),
    orderId: null,
    error: null,
    processedBy: null,
    processedAt: null,
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    minDaysBetweenOrders: 15,
    maxDailyOrders: 3,
    allowFridayOrders: true,
    startTime: '06:00',
    endTime: '10:00',
    assistantId: 'assistant-1',
    ...overrides,
  };
}

/** A signed-out session state, exactly as Stage 2 would produce it. */
export const SIGNED_OUT: SafeAuthState = Object.freeze({
  authenticated: false,
  uid: null,
  email: null,
  emailVerified: false,
  expirationTimeIso: null,
});

/** A signed-in session state. Deliberately carries NO token field. */
export function signedIn(overrides: Partial<SafeAuthState> = {}): SafeAuthState {
  return Object.freeze({
    authenticated: true,
    uid: 'uid-admin',
    email: 'admin@example.com',
    emailVerified: true,
    expirationTimeIso: '2026-09-29T10:00:00.000Z',
    ...overrides,
  });
}

/**
 * In-memory `AuthenticationSession`.
 *
 * The `idToken` / `refreshToken` fields model the Stage 2 service's PRIVATE
 * state. They are public here purely so a test can assert that they are set on
 * sign-in and nulled on sign-out - the containment evidence for requirements 4
 * and 5. The application layer receives this object through a port that has no
 * token getter, so it has no way to read them even by accident.
 */
export class FakeSession {
  public idToken: string | null = null;
  public refreshToken: string | null = null;
  private state: SafeAuthState = SIGNED_OUT;

  private readonly signInCalls: SignInCredentials[] = [];
  public signOutCalls = 0;

  public constructor(private readonly failure: Error | null = null) {}

  /**
   * A session that is ALREADY signed in.
   *
   * Used by tests about what happens AFTER authentication, so they do not have
   * to await a sign-in they are not testing.
   */
  public static signedIn(): FakeSession {
    const session = new FakeSession();
    session.state = signedIn();
    session.idToken = 'eyJhbGciOiJub25lIn0.eyJ1c2VyX2lkIjoidWlkLWFkbWluIn0.sig';
    session.refreshToken = 'refresh-token-value';
    return session;
  }

  /**
   * A session that has NEVER signed in.
   *
   * Stage 12 needs one to prove `listOrders` refuses an absent session before it
   * reaches the repository - a read that quietly succeeded with no session would
   * mean the auth check was decorative.
   */
  public static signedOut(): FakeSession {
    return new FakeSession();
  }

  /** Recorded as a readonly view; the backing array stays private. */
  public get credentialsSeen(): readonly SignInCredentials[] {
    return this.signInCalls;
  }

  public getSafeState(): SafeAuthState {
    return this.state;
  }

  public async signInWithEmailAndPassword(credentials: SignInCredentials): Promise<SafeAuthState> {
    this.signInCalls.push(credentials);
    if (this.failure !== null) {
      this.state = SIGNED_OUT;
      throw this.failure;
    }
    // Exactly what Stage 2 does: the tokens land in the Main process and nowhere
    // else. Nothing returned from this call carries them.
    this.idToken = 'eyJhbGciOiJub25lIn0.eyJ1c2VyX2lkIjoidWlkLWFkbWluIn0.sig';
    this.refreshToken = 'refresh-token-value';
    this.state = signedIn();
    return this.state;
  }

  public signOut(): void {
    this.signOutCalls += 1;
    this.idToken = null;
    this.refreshToken = null;
    this.state = SIGNED_OUT;
  }
}

/**
 * Records every `getUser` call so a test can assert the profile read happened once.
 */
export class FakeProfileReader {
  private readonly seen: string[] = [];

  public constructor(
    private readonly profile: User | null,
    private readonly failure: Error | null = null,
  ) {}

  public get calls(): readonly string[] {
    return this.seen;
  }

  public async getUser(uid: string): Promise<User | null> {
    this.seen.push(uid);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.profile;
  }
}

/**
 * Records calls and returns canned repository data.
 *
 * Stage 9 widened this fake: the five administrative writes now RECORD instead
 * of refusing, because Stage 9 is the stage that finally exercises them. They
 * still cannot change anything - the data is canned - so a passing test never
 * depends on a fake having real behaviour.
 */
export class FakeUsersRepository {
  private readonly seen: string[] = [];
  private readonly writes: { readonly method: string; readonly args: readonly unknown[] }[] = [];
  public listCalls = 0;

  public constructor(
    private readonly users: readonly User[] = [],
    private readonly failure: Error | null = null,
    private readonly profile: User | null = null,
  ) {}

  public get getUserCalls(): readonly string[] {
    return this.seen;
  }

  /** Every write call, in order, as `[method, args]`. */
  public get callOrder(): readonly string[] {
    return this.writes.map((entry) => entry.method);
  }

  /** How many write calls reached the repository at all. */
  public get totalCalls(): number {
    return this.writes.length;
  }

  /** The recorded calls to one named write method. */
  public callsTo(method: string): readonly (readonly unknown[])[] {
    return this.writes.filter((entry) => entry.method === method).map((entry) => entry.args);
  }

  /** Records a write, or surfaces the canned failure. */
  private record(method: string, args: readonly unknown[]): void {
    this.writes.push({ method, args });
    if (this.failure !== null) {
      throw this.failure;
    }
  }

  public async getUser(uid: string): Promise<User | null> {
    this.seen.push(uid);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.profile;
  }

  public async listAllUsers(): Promise<readonly User[]> {
    this.listCalls += 1;
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.users;
  }

  public async approveUser(uid: string): Promise<void> {
    this.record('approveUser', [uid]);
  }

  public async rejectUser(uid: string): Promise<void> {
    this.record('rejectUser', [uid]);
  }

  public async grantSingleOrderException(uid: string): Promise<void> {
    this.record('grantSingleOrderException', [uid]);
  }

  public async revokeSingleOrderException(uid: string): Promise<void> {
    this.record('revokeSingleOrderException', [uid]);
  }

  public async renameUser(uid: string, name: string): Promise<void> {
    this.record('renameUser', [{ uid, name }]);
  }
}

export class FakeMedicinesRepository {
  private readonly seen: number[] = [];
  private readonly medicineReads: string[] = [];
  private readonly writes: { readonly method: string; readonly args: readonly unknown[] }[] = [];

  public constructor(
    private readonly medicines: readonly Medicine[] = [],
    private readonly failure: Error | null = null,
  ) {}

  public get limits(): readonly number[] {
    return this.seen;
  }

  public get getMedicineCalls(): readonly string[] {
    return this.medicineReads;
  }

  /** The recorded `setMaxQuantity` calls, in order. */
  public get callsTo(): readonly (readonly [string, number])[] {
    return this.writes.map((entry) => entry.args as readonly [string, number]);
  }

  public async getMedicine(medicineId: string): Promise<Medicine | null> {
    this.medicineReads.push(medicineId);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.medicines.find((medicine) => medicine.id === medicineId) ?? null;
  }

  public async listMedicines(limit: number): Promise<readonly Medicine[]> {
    this.seen.push(limit);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.medicines;
  }

  /**
   * Stage 10 records the call; it changes nothing. The data is canned, so no
   * test can depend on a fake having real write behaviour.
   */
  public async setMaxQuantity(medicineId: string, maxQuantity: number): Promise<void> {
    this.writes.push({ method: 'setMaxQuantity', args: [medicineId, maxQuantity] });
    if (this.failure !== null) {
      throw this.failure;
    }
  }
}

/**
 * Stage 12: an `orders` fixture exactly as Stage 6 wrote it.
 *
 * `status` defaults to the value W1 stores (`'pending'`), not a "finished"
 * state: `orders.status` is the mobile app's own lifecycle and the Windows
 * history screen must not assume it means "processed".
 */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    userId: 'uid-emp',
    userName: 'أحمد',
    items: [{ medicineId: 'med-1', medicineName: 'Panadol', quantity: 2 }],
    date: timestamp('2026-06-03T08:00:00.000Z'),
    monthYear: '06-2026',
    status: 'pending',
    isExceptionOrder: false,
    requestId: 'req-1',
    ...overrides,
  };
}

/**
 * Stage 12: a READ-ONLY `OrdersRepository` fake.
 *
 * It deliberately implements NO write method, and cannot grow one by accident:
 * the production `OrdersRepository` contract declares none, so adding a writer
 * here would not satisfy the interface and the build would say so. That is the
 * point - a test double for the audit screen must not be able to fabricate an
 * order, and the type system is what guarantees it.
 */
export class FakeOrdersRepository {
  private readonly limits: number[] = [];
  private readonly ownerIds: string[] = [];
  private readonly pageTokens: (string | null)[] = [];
  private pageIndex = 0;

  public constructor(
    private readonly orders: readonly Order[] = [],
    private readonly failure: Error | null = null,
    private readonly pages: readonly {
      readonly orders?: readonly Order[];
      readonly nextPageToken?: string | null;
      readonly failure?: Error;
    }[] = [],
  ) {}

  /** Every limit the caller passed, in order, so tests can prove it is fixed. */
  public get seenLimits(): readonly number[] {
    return this.limits;
  }

  public get seenOwnerIds(): readonly string[] {
    return this.ownerIds;
  }

  public get seenPageTokens(): readonly (string | null)[] {
    return this.pageTokens;
  }

  public async getOrder(orderId: string): Promise<Order | null> {
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.orders.find((order) => order.id === orderId) ?? null;
  }

  public async listOrdersByUser(userId: string, limit: number): Promise<readonly Order[]> {
    this.ownerIds.push(userId);
    this.limits.push(limit);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.orders.filter((order) => order.userId === userId);
  }

  /** The unfiltered bounded list Stage 12 reads. */
  public async listOrders(limit: number): Promise<readonly Order[]> {
    this.limits.push(limit);
    if (this.failure !== null) {
      throw this.failure;
    }
    // The real repository does not sort, so neither does this fake: a test that
    // relied on ordering would be testing something the transport never promised.
    return this.orders;
  }

  public async listOrdersPage(
    limit: number,
    pageToken: string | null,
  ): Promise<{ readonly orders: readonly Order[]; readonly nextPageToken: string | null }> {
    this.limits.push(limit);
    this.pageTokens.push(pageToken);
    const page = this.pages[this.pageIndex++];
    if (page?.failure !== undefined) {
      throw page.failure;
    }
    if (this.failure !== null) {
      throw this.failure;
    }
    return Object.freeze({
      orders: page?.orders ?? (this.pages.length === 0 ? this.orders : []),
      nextPageToken: page?.nextPageToken ?? null,
    });
  }
}

/**
 * Stage 14: the stock movement audit double.
 *
 * READ-ONLY BY CONSTRUCTION, and deliberately so: the class declares no write
 * method at all, not even one that throws. A test double for an audit screen must
 * not be able to fabricate a stock movement, and the type system - not a comment -
 * is what guarantees it. This mirrors the real `StockLogsRepository`, whose contract
 * exposes exactly two list methods.
 *
 * It also does NOT sort. The REST layer has no `orderBy`, so a fake that sorted
 * would let a test pass on an ordering the transport never promised.
 */
export class FakeStockLogsRepository {
  private readonly limits: number[] = [];

  public constructor(
    private readonly logs: readonly StockLog[] = [],
    private readonly failure: Error | null = null,
  ) {}

  /** Every limit the caller passed, in order, so tests can prove it is fixed. */
  public get seenLimits(): readonly number[] {
    return this.limits;
  }

  public async listStockLogs(limit: number): Promise<readonly StockLog[]> {
    this.limits.push(limit);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.logs;
  }

  public async listStockLogsByOrder(orderId: string, limit: number): Promise<readonly StockLog[]> {
    this.limits.push(limit);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.logs.filter((log) => log.orderId === orderId);
  }
}

/**
 * Stage 15: a stand-in for the inbound-stock transaction.
 *
 * READ-ONLY BY CONSTRUCTION IN THE OTHER DIRECTION: this double can RECORD that a
 * receipt was queued, but it has no repository behind it and no way to write
 * anything. It exists so a test can assert WHAT the use case asked for - which
 * medicine, which absolute totals, what the log row said - without a Firestore.
 *
 * It deliberately does NOT implement any repository write. The point of Stage 15
 * is that the medicine update and the audit row cannot be separated, and a double
 * that could apply one without the other would let a test pass on the very
 * separation this stage forbids.
 */
export class FakeInboundStockTransaction {
  public readonly totals: { medicineId: string; stock: number; totalInward: number }[] = [];
  public readonly appendedLogs: NewInboundStockMovement[] = [];
  public commits = 0;
  public rollbacks = 0;

  public constructor(
    private readonly medicine: Medicine | null = null,
    private readonly failure: Error | null = null,
  ) {}

  public async readMedicine(_medicineId: string): Promise<Medicine | null> {
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.medicine;
  }

  public async applyInboundTotals(
    medicineId: string,
    absoluteStock: number,
    absoluteTotalInward: number,
  ): Promise<void> {
    this.totals.push({ medicineId, stock: absoluteStock, totalInward: absoluteTotalInward });
  }

  public async appendStockLog(movement: NewInboundStockMovement): Promise<void> {
    this.appendedLogs.push(movement);
  }

  public async commit(): Promise<void> {
    if (this.failure !== null) {
      throw this.failure;
    }
    this.commits += 1;
  }

  public async rollback(): Promise<void> {
    this.rollbacks += 1;
  }
}

/**
 * Stage 15: a factory over `FakeInboundStockTransaction`, so a test can hand the
 * service a fresh double per attempt and then inspect the LAST one.
 *
 * Returns the factory plus a reader for the transaction it produced. A retried
 * receipt begins a NEW transaction, so asserting against only the first would miss
 * everything the retry did.
 */
export function inboundStockFactory(
  options: {
    readonly medicine?: Medicine | null;
    readonly failure?: Error | null;
    readonly transactions?: FakeInboundStockTransaction[];
  } = {},
): {
  readonly factory: () => Promise<FakeInboundStockTransaction>;
  readonly begun: readonly FakeInboundStockTransaction[];
} {
  const begun: FakeInboundStockTransaction[] = options.transactions ?? [];
  const factory = async (): Promise<FakeInboundStockTransaction> => {
    const transaction = new FakeInboundStockTransaction(
      options.medicine === undefined ? makeMedicine() : options.medicine,
      options.failure ?? null,
    );
    begun.push(transaction);
    return transaction;
  };
  return { factory, begun };
}

export class FakeOrderRequestsRepository {
  private readonly seen: number[] = [];
  private readonly statusQueries: OrderRequestStatus[] = [];
  private readonly submissions: { readonly uid: string; readonly items: readonly OrderItem[] }[] = [];

  public constructor(
    private readonly requests: readonly OrderRequest[] = [],
    private readonly failure: Error | null = null,
    private readonly submissionId = 'req-generated-stage16',
    private readonly submissionFailure: Error | null = null,
    private readonly submissionGate?: Promise<void>,
  ) {}

  public get submitted(): readonly { readonly uid: string; readonly items: readonly OrderItem[] }[] {
    return this.submissions;
  }

  public get limits(): readonly number[] {
    return this.seen;
  }

  /** Stage 11: the status each `listOrderRequestsByStatus` call asked for, in order. */
  public get statusesQueried(): readonly OrderRequestStatus[] {
    return this.statusQueries;
  }

  public async getOrderRequest(requestId: string): Promise<OrderRequest | null> {
    // A rules refusal happens at the transport, so it applies to EVERY read and
    // not only to the list. Honouring it here is what lets a test tell "absent"
    // apart from "denied", which the UI must render differently.
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.requests.find((request) => request.id === requestId) ?? null;
  }

  public async listOrderRequestsByStatus(
    status: OrderRequestStatus,
    limit: number,
  ): Promise<readonly OrderRequest[]> {
    this.statusQueries.push(status);
    this.seen.push(limit);
    if (this.failure !== null) {
      throw this.failure;
    }
    // The real repository filters server-side on an EQUAL `status`; mirroring that
    // here keeps the fake honest, so a merged queue is not accidentally complete.
    return this.requests.filter((request) => request.status === status);
  }

  public async listPendingOrderRequests(limit: number): Promise<readonly OrderRequest[]> {
    return this.listOrderRequestsByStatus('pending', limit);
  }

  public async submitPendingRequest(input: {
    readonly uid: string;
    readonly items: readonly OrderItem[];
  }): Promise<string> {
    if (this.submissionFailure !== null) {
      throw this.submissionFailure;
    }
    if (this.submissionGate !== undefined) {
      await this.submissionGate;
    }
    this.submissions.push(input);
    return this.submissionId;
  }
}

export class FakeSettingsRepository {
  public calls = 0;

  public constructor(
    private readonly settings: AppSettings | null = null,
    private readonly failure: Error | null = null,
  ) {}

  public async getAppSettings(): Promise<AppSettings | null> {
    this.calls += 1;
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.settings;
  }

  public lastSaved: AppSettings | null = null;

  public async saveAppSettings(settings: AppSettings): Promise<void> {
    this.calls += 1;
    this.lastSaved = settings;
    if (this.failure !== null) {
      throw this.failure;
    }
  }
}

/** A `DomainError` of the kind a repository raises after Firestore answers 403. */
export function rulesDenied(documentPath: string | null = null): DomainError {
  return new DomainError('NOT_AUTHORIZED', 'rules denied the request', { documentPath });
}

/** Re-exported so the tests can name the domain taxonomy without a second import. */

/**
 * A fake Stage 6 `OrderProcessingService`.
 *
 * It records the request id AND the actor it was given, which lets the Stage 7
 * tests prove two separate things: that the order-processing algorithm is
 * DELEGATED rather than re-implemented, and that the actor comes from the
 * Main-process session instead of from renderer input.
 */
export class FakeOrderProcessingService implements OrderProcessingService {
  private readonly seen: { readonly requestId: string; readonly actor: OrderProcessingActor }[] = [];

  public constructor(
    private readonly outcome: OrderProcessingOutcome | Error = {
      result: { kind: 'success', orderId: 'order-9' },
      attempts: 1,
    },
  ) {}

  public get calls(): readonly { readonly requestId: string; readonly actor: OrderProcessingActor }[] {
    return this.seen;
  }

  public async process(requestId: string, actor: OrderProcessingActor): Promise<OrderProcessingOutcome> {
    this.seen.push({ requestId, actor });
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

export type { DomainErrorKind, OrderItem };
