/**
 * Stage 5B - Firestore implementation of the order-request, order and
 * stock-log repositories.
 *
 * The only WRITE here is `submitPendingRequest`, and it is deliberately the
 * narrowest possible: the payload is built from a fixed key set
 * ({uid, items, status, requestDate}) so it can satisfy the rules'
 * `hasOnly(...)` clause, and `requestDate` is the SERVER_TIMESTAMP marker so
 * Firestore stamps the authoritative request time (decision D4).
 *
 * QUERY LIMITS (Stage 3/5A): the REST client supports a single EQUAL filter and
 * no `orderBy`, no range and no cursor. So:
 *   - `status == 'pending'` and `userId == x` ARE expressible;
 *   - "orders for a user, newest first" is NOT, and no repository pretends
 *     otherwise - the result is explicitly documented as unsorted.
 */

import type { Order, OrderItem, OrderRequest, OrderRequestStatus, StockLog } from '../../domain/models';
import { generateAutoId } from '../../services/firestore-rest';
import type {
  OrderRequestsRepository,
  OrdersRepository,
  OrdersRepositoryPage,
  StockLogsRepository,
} from '../contracts/order-repository';
import { mapOrderRequest, mapNewOrderRequest } from './mappers/order-request-mapper';
import { mapOrder, mapStockLog } from './mappers/order-mapper';
import {
  type RepositoryContext,
  documentIdOf,
  documentPath,
  requireId,
  requirePositiveLimit,
  toDomainError,
} from './repository-support';
import { DomainError } from '../../domain/errors';

const ORDER_REQUESTS = 'order_requests';
const ORDERS = 'orders';
const STOCK_LOGS = 'stock_logs';

export class FirestoreOrderRequestsRepository implements OrderRequestsRepository {
  private readonly context: RepositoryContext;

  public constructor(context: RepositoryContext) {
    this.context = context;
  }

  public async getOrderRequest(requestId: string): Promise<OrderRequest | null> {
    const safeId = requireId(requestId, 'requestId');
    const path = documentPath(ORDER_REQUESTS, safeId);
    try {
      const document = await this.context.client.getDocumentOrNull(path);
      if (document === null) {
        return null;
      }
      return mapOrderRequest(
        documentIdOf(document),
        document.data,
        path,
        (actual) => this.context.onWarning?.(`${path}: unknown status "${actual}"`),
      );
    } catch (error: unknown) {
      throw toDomainError(error, path);
    }
  }

  /**
   * Stage 11: the single-EQUAL query `listPendingOrderRequests` already performs,
   * parameterised by the status value.
   *
   * The two methods are deliberately BOTH kept rather than replacing the older
   * one: `listPendingOrderRequests` is part of the Stage 5B contract that Stage 7
   * and its tests already exercise, and removing it would change established
   * behaviour for no gain. `listPendingOrderRequests` is now expressed in terms
   * of this one, so there is a single query shape in the file and the two cannot
   * drift apart.
   */
  public async listOrderRequestsByStatus(
    status: OrderRequestStatus,
    limit: number,
  ): Promise<readonly OrderRequest[]> {
    const safeLimit = requirePositiveLimit(limit);
    try {
      const documents = await this.context.client.runQuery({
        collectionId: ORDER_REQUESTS,
        where: { field: 'status', op: 'EQUAL', value: status },
        limit: safeLimit,
      });
      return Object.freeze(documents.map((document) => mapOrderRequest(
        documentIdOf(document),
        document.data,
        document.relativePath,
        (actual) => this.context.onWarning?.(`${document.relativePath}: unknown status "${actual}"`),
      )));
    } catch (error: unknown) {
      throw toDomainError(error, ORDER_REQUESTS);
    }
  }

  public async listPendingOrderRequests(limit: number): Promise<readonly OrderRequest[]> {
    return this.listOrderRequestsByStatus('pending', limit);
  }

  public async submitPendingRequest(input: {
    readonly uid: string;
    readonly items: readonly OrderItem[];
  }): Promise<string> {
    const safeUid = requireId(input.uid, 'uid');
    // The id is generated client-side: a document id must be known before the
    // commit, and the 20-character format matches Firestore's own Auto-ID.
    const requestId = generateAutoId();
    const path = documentPath(ORDER_REQUESTS, requestId);

    // `mapNewOrderRequest` fixes status='pending' and requestDate=SERVER_TIMESTAMP.
    const { data, kind } = mapNewOrderRequest({ uid: safeUid, items: input.items });

    try {
      await this.context.client.commitWrites([{ relativePath: path, data, kind }]);
      return requestId;
    } catch (error: unknown) {
      throw toDomainError(error, path);
    }
  }
}

export class FirestoreOrdersRepository implements OrdersRepository {
  private readonly context: RepositoryContext;

  public constructor(context: RepositoryContext) {
    this.context = context;
  }

  public async getOrder(orderId: string): Promise<Order | null> {
    const safeId = requireId(orderId, 'orderId');
    const path = documentPath(ORDERS, safeId);
    try {
      const document = await this.context.client.getDocumentOrNull(path);
      if (document === null) {
        return null;
      }
      return mapOrder(
        documentIdOf(document),
        document.data,
        path,
        (actual) => this.context.onWarning?.(`${path}: unknown status "${actual}"`),
      );
    } catch (error: unknown) {
      throw toDomainError(error, path);
    }
  }

  public async listOrdersByUser(userId: string, limit: number): Promise<readonly Order[]> {
    const safeUserId = requireId(userId, 'userId');
    const safeLimit = requirePositiveLimit(limit);
    try {
      const documents = await this.context.client.runQuery({
        collectionId: ORDERS,
        where: { field: 'userId', op: 'EQUAL', value: safeUserId },
        limit: safeLimit,
      });
      return Object.freeze(documents.map((document) => mapOrder(
        documentIdOf(document),
        document.data,
        document.relativePath,
        (actual) => this.context.onWarning?.(`${document.relativePath}: unknown status "${actual}"`),
      )));
    } catch (error: unknown) {
      throw toDomainError(error, ORDERS);
    }
  }

  /**
   * Stage 12: the bounded, unfiltered list the Orders History screen reads.
   *
   * `listDocuments` rather than `runQuery`, for the same reason `listStockLogs`
   * uses it: there is no equality to filter on - "every order" is the whole
   * requirement - and the REST layer has no `orderBy` to make the result
   * predictable. The mapping is therefore identical to `listOrdersByUser`'s, and
   * the "not sorted" caveat applies equally.
   *
   * firestore.rules refuses this query for a non-admin with 403; the refusal is
   * converted by `toDomainError` and surfaces as `AUTHORIZATION_DENIED`. No role
   * is checked here.
   */
  public async listOrders(limit: number): Promise<readonly Order[]> {
    return (await this.listOrdersPage(limit, null)).orders;
  }

  public async listOrdersPage(
    limit: number,
    pageToken: string | null,
  ): Promise<OrdersRepositoryPage> {
    const safeLimit = requirePositiveLimit(limit);
    if (pageToken !== null && (typeof pageToken !== 'string' || pageToken.length === 0)) {
      throw new DomainError('INVALID_INPUT', 'pageToken must be a non-empty opaque string');
    }
    try {
      const result = await this.context.client.listDocuments(ORDERS, {
        pageSize: safeLimit,
        ...(pageToken === null ? {} : { pageToken }),
      });
      return Object.freeze({
        orders: Object.freeze(result.documents.map((document) => mapOrder(
          documentIdOf(document),
          document.data,
          document.relativePath,
          (actual) => this.context.onWarning?.(`${document.relativePath}: unknown status "${actual}"`),
        ))),
        nextPageToken: result.nextPageToken,
      });
    } catch (error: unknown) {
      throw toDomainError(error, ORDERS);
    }
  }
}

/**
 * `stock_logs` is ADMIN-ONLY in both directions (firestore.rules line 86), and
 * the REST layer cannot express a date range, so this repository deliberately
 * offers a bounded list plus a single-EQUAL filter by `orderId` and nothing
 * more. The date-window query the Android inventory report performs (A4
 * generateInventoryPdf) is a Stage 7 concern; faking it here would be worse
 * than not having it.
 */
export class FirestoreStockLogsRepository implements StockLogsRepository {
  private readonly context: RepositoryContext;

  public constructor(context: RepositoryContext) {
    this.context = context;
  }

  public async listStockLogs(limit: number): Promise<readonly StockLog[]> {
    const safeLimit = requirePositiveLimit(limit);
    try {
      const result = await this.context.client.listDocuments(STOCK_LOGS, { pageSize: safeLimit });
      return Object.freeze(result.documents.map((document) => mapStockLog(
        documentIdOf(document),
        document.data,
        document.relativePath,
        (actual) => this.context.onWarning?.(`${document.relativePath}: unknown type "${actual}"`),
      )));
    } catch (error: unknown) {
      throw toDomainError(error, STOCK_LOGS);
    }
  }

  public async listStockLogsByOrder(orderId: string, limit: number): Promise<readonly StockLog[]> {
    const safeOrderId = requireId(orderId, 'orderId');
    const safeLimit = requirePositiveLimit(limit);
    try {
      const documents = await this.context.client.runQuery({
        collectionId: STOCK_LOGS,
        where: { field: 'orderId', op: 'EQUAL', value: safeOrderId },
        limit: safeLimit,
      });
      return Object.freeze(documents.map((document) => mapStockLog(
        documentIdOf(document),
        document.data,
        document.relativePath,
        (actual) => this.context.onWarning?.(`${document.relativePath}: unknown type "${actual}"`),
      )));
    } catch (error: unknown) {
      throw toDomainError(error, STOCK_LOGS);
    }
  }
}