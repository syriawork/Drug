/**
 * Stage 5B - order-request, order and stock-log repository contracts.
 *
 * firestore.rules:
 *   - order_requests: read own (or any, for admin); CREATE requires
 *     `isApproved()` + exactly {uid, items, status, requestDate};
 *     update/delete are `isAdmin()` only
 *   - orders:  read own or any (admin); write is `isAdmin()` only
 *   - stock_logs: read AND write are `isAdmin()` only
 *
 * Stage 5B is READ-ONLY for all three, plus the one employee submission that the
 * rules explicitly authorise (`submitPending`). Processing a request is Stage 6.
 */

import type { Order, OrderItem, OrderRequest, OrderRequestStatus, StockLog } from '../../domain/models';

export interface OrdersRepositoryPage {
  readonly orders: readonly Order[];
  readonly nextPageToken: string | null;
}

export interface OrderRequestsRepository {
  // ------------------------------------------------------------- READ

  /** Reads one request by its client-generated id. `null` when absent. */
  getOrderRequest(requestId: string): Promise<OrderRequest | null>;

  /**
   * Lists the requests still awaiting processing (`status == 'pending'`).
   *
   * This is expressible with the existing REST layer because it needs only an
   * EQUAL filter, which is the single operator the client supports. Admin only.
   */
  listPendingOrderRequests(limit: number): Promise<readonly OrderRequest[]>;

  /**
   * Stage 11: lists the requests carrying one exact `status`.
   *
   * WHY THIS EXISTS
   * `listPendingOrderRequests` alone cannot show a manager what already
   * happened: a request the Stage 6 engine marked `processed` or `failed` simply
   * disappears from that list, so the queue would look identical whether the work
   * succeeded, was refused, or was never attempted. Stage 11 must be able to
   * distinguish the three, and the only honest way is to read all three.
   *
   * WHY IT IS NOT A COMPOUND QUERY
   * This is the SAME single-EQUAL `runQuery` `listPendingOrderRequests` already
   * performs, parameterised by the status value. The REST client supports one
   * EQUAL filter and no `orderBy`, no range and no cursor, so the application
   * layer issues one call per known status and merges them. Nothing here needs an
   * operator the transport cannot express, and no unfiltered scan is used - which
   * matters because an unfiltered query on `order_requests` is refused by
   * firestore.rules for anyone but an admin ("rules are not filters").
   *
   * The `status` argument is typed as the domain's closed set, so a caller cannot
   * pass an unvalidated string into a server-side filter.
   */
  listOrderRequestsByStatus(status: OrderRequestStatus, limit: number): Promise<readonly OrderRequest[]>;

  // ----------------------------------------- EMPLOYEE WRITE (the only one)

  /**
   * Submits a new pending request for the signed-in employee.
   *
   * The signature makes two illegal requests unrepresentable:
   *  - there is no `status` parameter, because the rules force 'pending' and
   *    would answer 403 for anything else;
   *  - there is no `requestDate` parameter, because `requestDate` is always the
   *    Firestore SERVER timestamp (decision D4). A caller cannot smuggle in a
   *    client clock value, and cannot add an extra key either, because the
   *    payload is built from a fixed key set (see `ALLOWED_CREATE_KEYS`).
   */
  submitPendingRequest(input: {
    readonly uid: string;
    readonly items: readonly OrderItem[];
  }): Promise<string>;

  // -------------------------------------------------------- NOT PROVIDED
  //
  // markProcessed / markFailed - Stage 6 processing, deliberately excluded
  // deleteRequest                - admin-only but never needed by the design
  // updateRequestItems           - would bypass the processing contract
}

export interface OrdersRepository {
  // ------------------------------------------------------------- READ

  /** Reads one order. `null` when absent. */
  getOrder(orderId: string): Promise<Order | null>;

  /**
   * Lists orders owned by one user.
   *
   * Possible because the REST layer supports an EQUAL filter on a single field,
   * and `userId` is exactly the ownership field the rules require in the query
   * (an unfiltered query is refused with 403 - rules are not filters).
   *
   * The result is NOT sorted: `orderBy` is not supported by the REST layer
   * (Stage 3 limitation), so the caller must not assume newest-first order.
   */
  listOrdersByUser(userId: string, limit: number): Promise<readonly Order[]>;

  /**
   * Stage 12: a bounded list of EVERY order, for the history/audit screen.
   *
   * WHY THIS EXISTS ALONGSIDE `listOrdersByUser`
   * The manager's audit screen must show orders from every employee, and the
   * ownership filter cannot express "all": `userId == x` needs one value the
   * caller would have to invent. This is the smallest honest operation - a
   * bounded, unfiltered list - and it is the same shape `listStockLogs`
   * already uses.
   *
   * WHY IT IS ADMIN-ONLY IN PRACTICE, AND WHY THAT IS NOT DECIDED HERE
   * firestore.rules grants `orders` read to `isAdmin()` OR to the owner
   * (`resource.data.userId == request.auth.uid`). An UNFILTERED query cannot
   * prove ownership - "rules are not filters" - so Firestore refuses it for
   * anyone who is not an admin, and answers 403. That refusal is the rules'
   * verdict and reaches the caller as `AUTHORIZATION_DENIED`.
   *
   * This repository therefore does not perform a role check, and must not be
   * modified to make one: a local guess about who the server thinks the caller is
   * would replace the real authority with a stale copy of it.
   *
   * The result is NOT sorted, for the same reason as above: the REST layer has
   * no `orderBy`.
   */
  listOrders(limit: number): Promise<readonly Order[]>;

  /**
   * Stage 23: reads one bounded page of the administrator history.
   *
   * The opaque continuation token is owned by Main and never projected to the
   * renderer. `null` starts a fresh window; a returned `null` token is end-of-list.
   */
  listOrdersPage(
    limit: number,
    pageToken: string | null,
  ): Promise<OrdersRepositoryPage>;

  // -------------------------------------------------------- NOT PROVIDED
  //
  // createOrder / updateOrder / deleteOrder - orders are created ONLY by the
  // Stage 6 transaction (W1). A repository method that could write here would be
  // a second, unaudited way to fabricate an order, which is exactly what the
  // read-only Orders History screen must never become.
}

export interface StockLogsRepository {
  // ------------------------------------------------------------- READ

  /**
   * Lists stock movements.
   *
   * The REST layer has no range operator, so a "between two dates" query is NOT
   * expressed. The interface therefore offers the smallest honest abstraction:
   * a bounded list. The date filtering the Android report performs
   * (A4 generateInventoryPdf) is a Stage 7 concern and must not be faked here.
   *
   * `listByOrder` is possible only as a single EQUAL filter, and the rules
   * restrict the whole collection to admins anyway.
   */
  listStockLogs(limit: number): Promise<readonly StockLog[]>;

  /** Filters by `orderId` (single EQUAL filter). Admin only. */
  listStockLogsByOrder(orderId: string, limit: number): Promise<readonly StockLog[]>;

  // -------------------------------------------------------- NOT PROVIDED
  //
  // appendStockLog - writing a log without the order that caused it would
  //                   break the audit trail; logs are only written by the
  //                   Stage 6 transaction.
  //
  // Stage 15 - STILL NOT PROVIDED, AND THE REASON CHANGED.
  //
  // Stage 15 DID resolve the audit-coupling problem this contract used to cite,
  // and it deliberately did NOT resolve it here. `FirestoreInboundStockTransaction`
  // owns an `appendStockLog` that queues the receipt's audit row, because that
  // object also holds the `medicines` write in the same begin/commit cycle.
  //
  // Putting the method HERE instead would hand every caller a way to write a
  // `stock_logs` row with no matching stock change - the exact orphan-log failure
  // this contract was written to prevent - so the repository stays read-only and
  // the append is reachable only from inside a transaction that cannot commit
  // without the medicine update queued beside it.
}