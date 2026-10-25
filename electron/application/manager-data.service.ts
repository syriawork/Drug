/**
 * Stage 7 - the read use cases the manager UI needs.
 *
 * These four operations are deliberately dull: authenticate, read a collection
 * through its repository, project onto the safe view. That dullness is the
 * point - there is no filtering logic, no sorting, no pagination strategy and no
 * write of any kind here, because every one of those would be a place for the
 * renderer and the application layer to disagree with firestore.rules.
 *
 * THE LIMITS ARE FIXED HERE, NOT SUPPLIED BY THE RENDERER
 * Each use case passes a constant limit to its repository. The renderer cannot
 * ask for a different one, so it cannot turn a bounded list into a full
 * collection dump. A future paging design can widen this deliberately.
 *
 * NO AUTHORIZATION DECISION IS MADE HERE
 * `requireAuthenticatedUid` only asks whether a session exists. Whether the
 * signed-in user may read `users`, `medicines`, `order_requests` or
 * `settings/app` is decided by firestore.rules, and the answer arrives as a
 * `DomainError` of kind `NOT_AUTHORIZED` which becomes `AUTHORIZATION_DENIED`.
 * The application layer reports that verdict; it never produces one. A local
 * role check would be a guess about a server this process cannot read, and the
 * Stage 3 architecture guard already forbids one in the transport.
 */

/**
 * Imports come from the Stage 5B contract FILES, not from `repositories/`'s
 * barrel. The barrel re-exports the Firestore implementations too, and pulling
 * that in would give the application layer a compile-time path to the transport
 * - the exact dependency `docs/domain-data-architecture.md` §9.2 forbids.
 */
import type { MedicinesRepository, SettingsRepository } from '../repositories/contracts/medicines-repository';
import type { OrderRequestsRepository, OrdersRepository, StockLogsRepository } from '../repositories/contracts/order-repository';
import type { UsersRepository } from '../repositories/contracts/users-repository';
import type { AppSettings, Order, OrderRequest } from '../domain/models';
import { ORDER_REQUEST_STATUSES } from '../domain/values';
import { ApplicationError } from './application-error';
import { applicationSuccess, attempt, applicationRefusal } from './application-result';
import {
  toAppSettingsDraft,
  toAppSettingsView,
  toMedicineListItemView,
  toOrderHistoryItemView,
  toOrderRequestListItemView,
  toPersonalOrderHistoryItemView,
  toStockLogView,
  toUserListItemView,
} from './views';

/** The repositories this layer needs; deliberately the Stage 5B CONTRACTS. */
export interface ManagerRepositories {
  readonly users: UsersRepository;
  readonly medicines: MedicinesRepository;
  readonly settings: SettingsRepository;
  readonly orderRequests: OrderRequestsRepository;
  /** Stage 12: READ-ONLY. Orders are written only by the Stage 6 transaction. */
  readonly orders: OrdersRepository;
  /**
   * Stage 14: READ-ONLY. The inventory movement audit trail.
   *
   * `StockLogsRepository` declares only two list methods - there is no append,
   * update or delete anywhere on the contract, so a stock movement cannot be
   * written from the application layer even by accident.
   */
  readonly stockLogs: StockLogsRepository;
}

/** Supplies the current safe auth state; never a token. */
export interface AuthStateSource {
  getState(): SafeAuthState;
}

/**
 * Fixed page sizes.
 *
 * `users` and `medicines` mirror the repositories' own upper bound; the request
 * queue is smaller because it is the screen a manager actually works through.
 */
export const MANAGER_LIST_LIMITS = Object.freeze({
  users: 500,
  medicines: 500,
  orderRequests: 200,
  /**
   * Stage 12: the audit page is a bounded window over history, not a full dump.
   * 500 matches the other "everything" reads so the limit is a uniform page
   * size rather than a judgement about which orders matter.
   */
  orders: 500,
  /** Stage 17: the same bounded window, scoped to the authenticated owner. */
  personalOrders: 500,
  /**
   * Stage 14: the movement audit trail is the highest-volume read in the app -
   * every processed order writes one row PER LINE - so its window is the same
   * uniform page size as the other bounded lists, and the screen says plainly
   * that it is a window rather than a complete history.
   */
  stockLogs: 500,
  /** Stage 19: one bounded window scoped to the selected order. */
  stockLogsByOrder: 500,
});

export interface ManagerApplicationServiceOptions {
  readonly repositories: ManagerRepositories;
  readonly auth: AuthStateSource;
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}

export class ManagerApplicationService {
  private readonly repositories: ManagerRepositories;
  private readonly auth: AuthStateSource;
  private readonly onDiagnostic: ((message: string) => void) | undefined;
  private ordersHistoryNextPageToken: string | null = null;
  private readonly ordersHistoryPageTokens = new Set<string>();
  private ordersHistoryOwnerUid: string | null = null;
  private ordersHistoryNamesByUid: Map<string, string> | null = null;
  private ordersHistoryPageInFlight = false;

  public constructor(options: ManagerApplicationServiceOptions) {
    this.repositories = options.repositories;
    this.auth = options.auth;
    this.onDiagnostic = options.onDiagnostic;
  }

  /** Lists every profile. Admin-only in firestore.rules; an employee gets 403. */
  public listUsers(): Promise<ApplicationResult<readonly UserListItemView[]>> {
    if (!this.auth.getState().authenticated) {
      return Promise.resolve(applicationRefusal('AUTHENTICATION_FAILED', { retryable: false, diagnostic: 'listUsers without a session' }));
    }
    return attempt(
      async () => (await this.repositories.users.listAllUsers()).map(toUserListItemView),
      this.onDiagnostic,
    );
  }

  /** Lists the catalogue. Readable by any authenticated user under A1. */
  public listMedicines(): Promise<ApplicationResult<readonly MedicineListItemView[]>> {
    if (!this.auth.getState().authenticated) {
      return Promise.resolve(applicationRefusal('AUTHENTICATION_FAILED', { retryable: false, diagnostic: 'listMedicines without a session' }));
    }
    return attempt(
      async () => (await this.repositories.medicines.listMedicines(MANAGER_LIST_LIMITS.medicines)).map(toMedicineListItemView),
      this.onDiagnostic,
    );
  }

  /**
   * Lists the request queue across ALL THREE known statuses.
   *
   * Stage 7 listed only `pending`, which is correct for "what needs my attention"
   * but silently hides everything Stage 6 already handled: a request the engine
   * marked `processed` or `failed` simply vanished, so a manager could not tell a
   * completed order from a refusal from an untouched request. Stage 11 needs the
   * distinction, so this reads each status and merges.
   *
   * WHY THREE CALLS AND NOT ONE CLEVER QUERY
   * The REST client supports exactly one EQUAL filter, no `orderBy` and no range,
   * so "any of these three statuses" is not expressible server-side. Issuing one
   * established query per known status uses no operator the transport lacks, and
   * crucially avoids an unfiltered scan - which firestore.rules refuses for
   * anyone but an admin, because rules are not filters.
   *
   * WHY `ORDER_REQUEST_STATUSES` IS THE LIST
   * The loop is driven by the domain's own closed set, so a status added to the
   * domain later is picked up automatically and an unknown value can never be sent
   * as a server-side filter.
   *
   * THE ORDER OF THE RESULT
   * The transport cannot sort (no `orderBy`), so the merged order is whatever the
   * per-status queries returned. The renderer must NOT assume newest-first, and
   * this method does not pretend otherwise. Sorting a queue by date in the client
   * would be a new presentation rule the domain never established, so the renderer
   * simply preserves the order it was given.
   */
  public async listOrderRequests(): Promise<ApplicationResult<readonly OrderRequestListItemView[]>> {
    if (!this.auth.getState().authenticated) {
      return Promise.resolve(applicationRefusal('AUTHENTICATION_FAILED', { retryable: false, diagnostic: 'listOrderRequests without a session' }));
    }
    return attempt(async () => {
      const collected: OrderRequest[] = [];
      for (const status of ORDER_REQUEST_STATUSES) {
        collected.push(...(await this.repositories.orderRequests.listOrderRequestsByStatus(
          status,
          MANAGER_LIST_LIMITS.orderRequests,
        )));
      }
      // Best effort, and deliberately so: `listAllUsers` is admin-only, so for any
      // other caller this throws and every name stays `null`. That must NOT turn a
      // readable queue into an error page - the uid is still authoritative.
      const namesByUid = await this.resolveEmployeeNames(collected);
      return collected.map((request) => toOrderRequestListItemView(request, namesByUid.get(request.uid) ?? null));
    }, this.onDiagnostic);
  }

  /**
   * Builds a uid -> name map for the employees named by the given requests.
   *
   * ONE `listAllUsers` call for the whole page, never a lookup per request: a
   * queue of 200 requests would otherwise be 200 round trips. Any failure - most
   * commonly the admin-only rules refusal - yields an empty map, and the view
   * falls back to the uid.
   */
  private async resolveEmployeeNames(requests: readonly OrderRequest[]): Promise<Map<string, string>> {
    const wanted = new Set(requests.map((request) => request.uid));
    if (wanted.size === 0) {
      return new Map();
    }
    try {
      const users = await this.repositories.users.listAllUsers();
      const names = new Map<string, string>();
      for (const user of users) {
        if (wanted.has(user.uid) && user.name.trim().length > 0) {
          names.set(user.uid, user.name);
        }
      }
      return names;
    } catch {
      // Deliberately swallowed: this is decoration, not data. See the doc comment.
      return new Map();
    }
  }

  /**
   * Stage 12: lists processed orders for the history/audit screen.
   *
   * READ-ONLY BY CONSTRUCTION. This method calls exactly one repository method,
   * and the `OrdersRepository` contract it is typed against has no create,
   * update or delete at all - so there is no code path from this screen to a
   * write. Orders are produced only by the Stage 6 transaction (W1).
   *
   * NO SORTING IS ATTEMPTED. The REST layer has no `orderBy`, so the result is
   * whatever the server returned. Sorting by date here would be a presentation
   * rule the domain never established and would silently imply a newest-first
   * guarantee the transport cannot keep.
   *
   * NO LOCAL AUTHORIZATION CHECK. Only session presence is verified, exactly as
   * for `listMedicines`; whether this caller may read `orders` at all is decided
   * by firestore.rules and arrives as `AUTHORIZATION_DENIED`.
   */
  public async listOrders(): Promise<ApplicationResult<readonly OrderHistoryItemView[]>> {
    if (!this.auth.getState().authenticated) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'listOrders without a session',
      });
    }
    return attempt(
      async () => {
        const orders = await this.repositories.orders.listOrders(MANAGER_LIST_LIMITS.orders);
        // Best effort, for the same reason as `listOrderRequests`: reading every
        // profile is admin-only, so for any other caller this throws. A missing
        // name must not turn a readable audit page into an error page - and the
        // order's own stored snapshot is preferred anyway (see the view).
        const namesByUid = await this.resolveOrderEmployeeNames(orders);
        return orders.map((order) => toOrderHistoryItemView(order, namesByUid.get(order.userId) ?? null));
      },
      this.onDiagnostic,
    );
  }

  /** Stage 23: starts a new administrator-history window and keeps its cursor in Main. */
  public async listOrderHistoryPage(): Promise<ApplicationResult<OrderHistoryPageView>> {
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null || state.uid.length === 0) {
      this.resetOrderHistoryPagination();
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'listOrderHistoryPage without an authenticated Main-process uid',
      });
    }
    if (this.ordersHistoryPageInFlight) {
      return applicationRefusal('INFRASTRUCTURE_FAILURE', {
        retryable: true,
        diagnostic: 'orders history page request already in flight',
      });
    }

    this.ordersHistoryPageInFlight = true;
    this.resetOrderHistoryPagination();
    this.ordersHistoryOwnerUid = state.uid;
    try {
      return await attempt(async () => {
        const page = await this.repositories.orders.listOrdersPage(MANAGER_LIST_LIMITS.orders, null);
        const namesByUid = await this.resolveOrderEmployeeNames(page.orders);
        const orders = page.orders.map((order) => toOrderHistoryItemView(order, namesByUid.get(order.userId) ?? null));
        this.ordersHistoryNamesByUid = namesByUid;
        this.ordersHistoryNextPageToken = page.nextPageToken;
        if (page.nextPageToken !== null) {
          this.ordersHistoryPageTokens.add(page.nextPageToken);
        }
        return Object.freeze({ orders: Object.freeze(orders), hasMore: page.nextPageToken !== null });
      }, this.onDiagnostic);
    } finally {
      this.ordersHistoryPageInFlight = false;
    }
  }

  /** Stage 23: advances only the Main-owned cursor; a failed page retains it for retry. */
  public async loadMoreOrderHistory(): Promise<ApplicationResult<OrderHistoryPageView>> {
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null || state.uid.length === 0) {
      this.resetOrderHistoryPagination();
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'loadMoreOrderHistory without an authenticated Main-process uid',
      });
    }
    if (this.ordersHistoryPageInFlight) {
      return applicationRefusal('INFRASTRUCTURE_FAILURE', {
        retryable: true,
        diagnostic: 'orders history page request already in flight',
      });
    }
    if (this.ordersHistoryOwnerUid !== state.uid) {
      this.resetOrderHistoryPagination();
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'orders history cursor belongs to a different authenticated uid',
      });
    }
    const pageToken = this.ordersHistoryNextPageToken;
    if (pageToken === null) {
      return applicationSuccess(Object.freeze({ orders: Object.freeze([]), hasMore: false }));
    }

    this.ordersHistoryPageInFlight = true;
    try {
      return await attempt(async () => {
        const page = await this.repositories.orders.listOrdersPage(MANAGER_LIST_LIMITS.orders, pageToken);
        if (page.nextPageToken !== null && this.ordersHistoryPageTokens.has(page.nextPageToken)) {
          this.ordersHistoryNextPageToken = null;
          throw new ApplicationError('INTERNAL_ERROR', {
            retryable: false,
            diagnostic: 'Firestore repeated an orders history page token',
          });
        }
        const namesByUid = this.ordersHistoryNamesByUid ?? new Map<string, string>();
        const orders = page.orders.map((order) => toOrderHistoryItemView(order, namesByUid.get(order.userId) ?? null));
        this.ordersHistoryNextPageToken = page.nextPageToken;
        if (page.nextPageToken !== null) {
          this.ordersHistoryPageTokens.add(page.nextPageToken);
        }
        return Object.freeze({ orders: Object.freeze(orders), hasMore: page.nextPageToken !== null });
      }, this.onDiagnostic);
    } finally {
      this.ordersHistoryPageInFlight = false;
    }
  }

  private resetOrderHistoryPagination(): void {
    this.ordersHistoryNextPageToken = null;
    this.ordersHistoryPageTokens.clear();
    this.ordersHistoryOwnerUid = null;
    this.ordersHistoryNamesByUid = null;
  }

  /**
   * Stage 17: reads only the authenticated user's orders.
   *
   * The UID is obtained from the Main-process auth state, never from Renderer
   * input. The repository applies that owner filter; Firestore Rules remain the
   * authorization authority. The result is a bounded, unsorted window.
   */
  public async listMyOrders(): Promise<ApplicationResult<readonly PersonalOrderHistoryItemView[]>> {
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null || state.uid.length === 0) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'listMyOrders without an authenticated Main-process uid',
      });
    }
    const uid = state.uid;
    return attempt(
      async () => (await this.repositories.orders.listOrdersByUser(
        uid,
        MANAGER_LIST_LIMITS.personalOrders,
      )).map(toPersonalOrderHistoryItemView),
      this.onDiagnostic,
    );
  }

  /**
   * Builds a bounded uid -> live-name cache for the history window.
   *
   * The first page already needs this best-effort lookup for legacy orders with
   * empty name snapshots. Retaining the returned cache lets later pages avoid
   * unrelated user reads; any failure, including the admin-only Rules refusal,
   * degrades to the stored snapshot or uid and never removes an order.
   */
  private async resolveOrderEmployeeNames(orders: readonly Order[]): Promise<Map<string, string>> {
    if (orders.length === 0) {
      return new Map();
    }
    try {
      const users = await this.repositories.users.listAllUsers();
      const names = new Map<string, string>();
      for (const user of users) {
        if (user.name.trim().length > 0) {
          names.set(user.uid, user.name);
        }
      }
      return names;
    } catch {
      // Deliberately swallowed: decoration, not data.
      return new Map();
    }
  }

  /**
   * Stage 14: lists inventory movements for the audit screen.
   *
   * READ-ONLY BY CONSTRUCTION. This calls exactly one repository method, and the
   * `StockLogsRepository` contract it is typed against declares NO append, update
   * or delete - so there is no path from this screen to a stock write. Movements
   * are produced only by the Stage 6 transaction (W1/W2) and by the mobile app.
   *
   * NO AGGREGATION OF ANY KIND. The rows are returned one for one, in the stored
   * shape. In particular this method does NOT sum `quantity`, does NOT net inward
   * against outward, and does NOT compute a balance: `stock` is a stored field in
   * `medicines`, and any balance derived here would be a number the database
   * never contained. Deriving one would also be wrong on its face, because
   * `quantity` is a positive magnitude for BOTH directions and only `type` carries
   * the sign.
   *
   * NO SORTING IS ATTEMPTED. The REST layer has no `orderBy`, so the result is
   * whatever the server returned. Presenting these rows as a chronological
   * history would be a promise the transport cannot keep, so the screen shows
   * each movement's own timestamp instead of implying an ordering it cannot see.
   *
   * NO LOCAL AUTHORIZATION CHECK, exactly as for `listOrders`. `stock_logs` is
   * admin-only in firestore.rules (line 86); an employee receives 403 and that
   * verdict arrives here as `AUTHORIZATION_DENIED` and is reported honestly.
   */
  public async listStockMovements(): Promise<ApplicationResult<readonly StockLogView[]>> {
    if (!this.auth.getState().authenticated) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'listStockMovements without a session',
      });
    }

    return attempt(
      async () => {
        const movements = await this.repositories.stockLogs.listStockLogs(MANAGER_LIST_LIMITS.stockLogs);
        return movements.map((movement) => toStockLogView(movement));
      },
      this.onDiagnostic,
    );
  }

  /**
   * Stage 19: reads the stored movements for one selected finalized order.
   *
   * The caller can supply only the order id; the authenticated identity and
   * authorization remain owned by Main and Firestore Rules respectively.
   */
  public async listStockMovementsByOrder(payload: unknown): Promise<ApplicationResult<readonly StockLogView[]>> {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return applicationRefusal('VALIDATION_FAILED', {
        retryable: false,
        diagnostic: 'rejected a malformed stock-log order payload',
      });
    }
    const candidate = payload as Record<string, unknown>;
    if (Object.keys(candidate).length !== 1 || !Object.hasOwn(candidate, 'orderId')) {
      return applicationRefusal('VALIDATION_FAILED', {
        retryable: false,
        diagnostic: 'rejected unexpected stock-log order payload fields',
      });
    }
    const orderId = candidate['orderId'];
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) {
      return applicationRefusal('VALIDATION_FAILED', {
        retryable: false,
        diagnostic: 'rejected a malformed stock-log order id',
      });
    }
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null || state.uid.length === 0) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'listStockMovementsByOrder without an authenticated Main-process uid',
      });
    }
    return attempt(
      async () => (await this.repositories.stockLogs.listStockLogsByOrder(
        orderId,
        MANAGER_LIST_LIMITS.stockLogsByOrder,
      )).map(toStockLogView),
      this.onDiagnostic,
    );
  }

  /** Reads `settings/app`, or the enforced defaults when the document is absent. */
  public getSettings(): Promise<ApplicationResult<AppSettingsView>> {
    if (!this.auth.getState().authenticated) {
      return Promise.resolve(applicationRefusal('AUTHENTICATION_FAILED', { retryable: false, diagnostic: 'getSettings without a session' }));
    }
    return attempt(
      async () => toAppSettingsView(await this.repositories.settings.getAppSettings()),
      this.onDiagnostic,
    );
  }

  /**
   * Stage N: saves the four editable rule fields back to `settings/app`.
   *
   * The renderer only ever sends `minDaysBetweenOrders`, `allowFridayOrders`,
   * `startTime` and `endTime`. The dead fields (`maxDailyOrders`,
   * `assistantId`) are preserved from the currently stored document so a
   * Windows save never wipes values the Windows processing model does not
   * touch. The current document is read first, then the draft is merged in,
   * and the full `AppSettings` is handed to the repository.
   */
  public async saveSettings(draft: unknown): Promise<ApplicationResult<null>> {
    if (!this.auth.getState().authenticated) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'saveSettings without a session',
      });
    }

    const validated = toAppSettingsDraft(draft);
    if (!validated.ok) {
      return validated;
    }

    return attempt(
      async () => {
        const current = await this.repositories.settings.getAppSettings();
        const source = current ?? {
          minDaysBetweenOrders: 15,
          maxDailyOrders: 0,
          allowFridayOrders: false,
          startTime: '06:00',
          endTime: '10:00',
          assistantId: '',
        };
        const merged: AppSettings = Object.freeze({
          minDaysBetweenOrders: validated.value.minDaysBetweenOrders,
          maxDailyOrders: source.maxDailyOrders,
          allowFridayOrders: validated.value.allowFridayOrders,
          startTime: validated.value.startTime,
          endTime: validated.value.endTime,
          assistantId: source.assistantId,
        });
        await this.repositories.settings.saveAppSettings(merged);
        return null;
      },
      this.onDiagnostic,
    );
  }
}
