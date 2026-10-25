/// <reference path="./ipc-contract.d.ts" />

/**
 * Stage 7 - the SAFE domain view handed to the renderer.
 *
 * TYPES ONLY (no runtime code, no imports), so both builds can read this file:
 *   - the Node-side build  (electron/**, tests/**)
 *   - the renderer build   (src/renderer/**, through ipc-contract.d.ts)
 *
 * WHY A SEPARATE FILE
 * `ipc-contract.d.ts` is the TRANSPORT: the operations and the result envelope.
 * This file is the CONTENT those operations carry. Keeping them apart means a
 * reviewer can read this one file and know exactly what data the UI is allowed
 * to see, without reasoning about envelopes.
 *
 * FOUR RULES EVERY TYPE BELOW OBEYS
 *
 *  1. NO TOKENS. No token-shaped field exists anywhere in this file; the ID
 *     token and the refresh token never leave the Main process.
 *  2. NO FIRESTORE WIRE FORMAT. A `DomainTimestamp` is a `FirestoreTimestamp`
 *     CLASS instance; structured-cloning it over IPC would deliver a plain
 *     object whose `toDate()` no longer exists. Every timestamp is therefore
 *     flattened to an ISO-8601 string (or `null`) HERE, in the Main process.
 *  3. NO DOCUMENT PATHS. `users/abc123` is a storage detail; the UI is given
 *     domain ids, never paths.
 *  4. NO CLASSES AND NO METHODS. Everything here survives `structuredClone`
 *     unchanged, which is what makes a payload safe to freeze and to compare.
 *
 * The stage 5B/6 domain models stay where they are; these are projections of
 * them, built in `electron/application/views.ts`.
 */

/**
 * `users/{uid}.role`, mirrored from `domain/values.ts`.
 *
 * ADVISORY ONLY. It exists so the UI can hide a control the signed-in user
 * would be refused anyway. It is NEVER an authorization input: firestore.rules
 * is the only authority, and a local role check proves nothing.
 */
type UserRoleView = 'admin' | 'assistant' | 'employee';

/** `users/{uid}.status`, mirrored from `domain/values.ts`. */
type UserStatusView = 'pending' | 'approved' | 'rejected';

/** `order_requests/{id}.status`, mirrored from `domain/values.ts`. */
type OrderRequestStatusView = 'pending' | 'processed' | 'failed';

/**
 * `orders.status` / `users.lastOrderStatus`.
 *
 * The EMPTY STRING is a real, production-observed value meaning "this user has
 * never ordered", so it is a member of the union rather than a missing value.
 */
type OrderStatusView = 'pending' | 'accepted' | 'rejected' | '';

/** One `users/{id}` row as the manager list renders it. */
interface UserListItemView {
  readonly uid: string;
  readonly name: string;
  readonly employeeId: string;
  readonly role: UserRoleView;
  readonly status: UserStatusView;
  readonly hasException: boolean;
  readonly lastOrderId: string | null;
  /** `DomainTimestamp` flattened to ISO-8601; `null` when never ordered. */
  readonly lastOrderDateIso: string | null;
  /** Raw `MM-yyyy`, exactly as persisted (may hold Arabic-Indic digits). */
  readonly lastOrderMonthYear: string;
  /**
   * Stage 9: the same month normalised for DISPLAY, or `null` when the stored
   * value is not a recognisable month (the empty string means "never ordered").
   *
   * The RAW value stays in `lastOrderMonthYear`. This second field exists only so
   * the renderer can show `06-2026` for a document that stores `٠٦-٢٠٢٦`
   * (conflict D1) without the renderer owning a normalisation rule - and, more
   * importantly, so that no code path is tempted to WRITE the normalised form
   * back. Normalisation here is read-side presentation, never a migration.
   */
  readonly lastOrderMonthYearDisplay: string | null;
  readonly lastOrderStatus: OrderStatusView | null;
  readonly lastOrderIsException: boolean;
}

/** One `medicines/{id}` row as the catalogue list renders it. */
interface MedicineListItemView {
  readonly id: string;
  readonly name: string;
  readonly maxQuantity: number;
  readonly stock: number;
  readonly totalInward: number;
  readonly totalOutward: number;
}

/** One line of an `order_requests/{id}` document. */
interface OrderRequestItemView {
  readonly medicineId: string;
  readonly medicineName: string;
  readonly quantity: number;
}

/** Stage 16: the repository-generated id returned after a request is created. */
interface OrderRequestSubmissionView {
  readonly requestId: string;
}

/** One `order_requests/{id}` row as the manager queue renders it. */
interface OrderRequestListItemView {
  readonly id: string;
  /** The ONLY employee identity the request document actually stores. */
  readonly uid: string;
  /**
   * Stage 11: the employee's display name resolved from `users/{uid}`, or `null`.
   *
   * NOT a field of `OrderRequest` - the mobile submission path never stored one.
   * `null` means "not resolved", never "no employee", and the renderer falls back
   * to `uid`. Presentation only: no update path exists that could write it.
   */
  readonly employeeName: string | null;
  readonly items: readonly OrderRequestItemView[];
  readonly status: OrderRequestStatusView;
  readonly requestDateIso: string;
  /** The `orders/{id}` this request produced; `null` until processed. */
  readonly orderId: string | null;
  /**
   * A2's own user-facing reason, written when the request was marked `failed`.
   *
   * This is domain data, NOT a transport error: it is the business sentence A2
   * committed, and it is safe to show. A technical Firestore failure never lands
   * here - those stay in the Main-process log.
   */
  readonly error: string | null;
  /** The admin uid, or the legacy literal "backend-v1". */
  readonly processedBy: string | null;
  readonly processedAtIso: string | null;
}

/**
 * Stage 12: one `orders/{id}` row as the history/audit screen renders it.
 *
 * EVERY FIELD IS AN EXISTING ORDER FIELD. Nothing here is computed from another
 * value: no summed quantity, no stock figure, no eligibility verdict. A history
 * screen that published a derived number would be a second implementation of
 * Stage 6 that could disagree with the one that actually wrote the order.
 */
interface OrderHistoryItemView {
  readonly id: string;
  /**
   * The EMPLOYEE the order belongs to - the stored `orders.userId`.
   *
   * Three different people appear across the order pipeline and must not be
   * blended: this one (the recipient), `order_requests.uid` (who submitted the
   * request) and `order_requests.processedBy` (the ADMIN who processed it).
   */
  readonly userId: string;
  /**
   * The employee's display name, or `null`.
   *
   * Stage 6 stores a `userName` SNAPSHOT on the order, and that snapshot wins:
   * this is an audit surface, so the recorded value is the historical truth and
   * a later rename must not rewrite what the order said. A live profile name is
   * supplied only when the stored snapshot is empty (a legacy document).
   * `null` means "no name available"; the renderer then falls back to `userId`.
   */
  readonly employeeName: string | null;
  readonly items: readonly OrderRequestItemView[];
  /**
   * A COUNT OF LINES, never a sum of quantities. Aggregating duplicate lines is
   * Stage 6's job and may legitimately refuse them; summing here would publish a
   * total the stored order never contained.
   */
  readonly itemCount: number;
  readonly dateIso: string;
  /** Raw `MM-yyyy` exactly as persisted (may hold Arabic-Indic digits). */
  readonly monthYear: string;
  /** The normalised month for display; `null` when the stored value is unusable. */
  readonly monthYearDisplay: string | null;
  /**
   * The MOBILE app's own order lifecycle, as written by W1 (`'pending'`) or by
   * the Android app.
   *
   * This is NOT the request status: an order in the history is not necessarily a
   * processed request, and the screen must not relabel it as one.
   */
  readonly status: OrderStatusView;
  readonly isExceptionOrder: boolean;
  /** The `order_requests/{id}` this order came from; `null` for pre-existing orders. */
  readonly requestId: string | null;
}

/** Stage 23: one administrator-history page; the Firestore cursor stays in Main. */
interface OrderHistoryPageView {
  readonly orders: readonly OrderHistoryItemView[];
  readonly hasMore: boolean;
}

/** Stage 17: the minimum safe data needed to display an employee's own orders. */
interface PersonalOrderHistoryItemView {
  readonly id: string;
  readonly items: readonly {
    readonly medicineName: string;
    readonly quantity: number;
  }[];
  readonly itemCount: number;
  readonly dateIso: string;
  readonly monthYearDisplay: string | null;
  readonly status: OrderStatusView;
}

/**
 * Stage 15: an inbound stock receipt - goods arriving into stock.
 *
 * TWO KEYS, NO MORE. `medicineId` and `quantity` are the whole request; a key that
 * appears here is a key the use case must handle, and one that does not appear is
 * unreachable by the renderer. `stock`, `totalInward`, `totalOutward`, `name`,
 * `medicineName`, `type` and `uid` are ALL absent on purpose:
 *  - `stock` and the totals are ABSOLUTE values computed in Main from the stock read
 *    inside the transaction, because the REST client cannot express an increment;
 *  - `medicineName` is a snapshot the Main process reads, so a renderer cannot file
 *    a log row naming a medicine that does not exist;
 *  - `uid` is the signed-in administrator, never anything the renderer supplies;
 *  - `type` is always `inward`. An outward movement is Stage 6's business and is not
 *    expressible through this channel at all.
 */
interface AddInboundStockInput {
  /** Pattern-checked in Main before it can reach a document path. */
  readonly medicineId: string;
  /** A POSITIVE integer magnitude; the direction is fixed by the operation. */
  readonly quantity: number;
}

/**
 * The outcome of one accepted inbound receipt.
 *
 * The ABSOLUTE post-receipt values, reported rather than patched: the renderer
 * re-reads the catalogue after a successful write rather than trusting these, so
 * what it displays is always what the server stored. They are here so the receipt
 * dialog can report what happened without a second round trip, and so a test can
 * assert the arithmetic the transaction actually performed.
 *
 * `quantity` is the RECEIVED magnitude, never a new balance and never signed.
 */
interface InboundStockReceiptView {
  readonly medicineId: string;
  /** The medicine name as it was at write time - a snapshot, not a re-resolve. */
  readonly medicineName: string;
  readonly newStock: number;
  readonly newTotalInward: number;
  readonly quantity: number;
}

/**
 * `stock_logs.type`, mirrored from `domain/values.ts`.
 *
 * A CLOSED SET of two, because those are the only two strings the domain
 * recognises. The mapper already degrades an unrecognised stored value to
 * `inward` and reports it as a warning, so no third "unknown" member is invented
 * here: the UI renders what the read layer decided, and the diagnostic is what
 * tells the truth about what was actually stored.
 */
type StockMovementTypeView = 'inward' | 'outward';

/**
 * ONE `stock_logs/{id}` row, exactly as the Stage 6 transaction wrote it.
 *
 * This is the AUDIT TRAIL, and every field here is a historical fact. Nothing in
 * this shape is derived, netted, summed or reconciled - a movement log answers
 * "what happened, and when", never "what is the balance now".
 *
 * THE ONE HARD RULE: `quantity` is a POSITIVE MAGNITUDE for both directions, and
 * `type` alone carries the sign. A4 line 595 stores `Math.abs(diff)`, so an
 * outward movement of 5 is stored as `quantity: 5, type: 'outward'` and NEVER as
 * `-5`. A renderer that adds the quantities would therefore report every outward
 * movement as an inflow, so nothing downstream may aggregate this field without
 * reading `type` first - and the simplest way to guarantee that is for nothing
 * downstream to aggregate it at all.
 */
interface StockLogView {
  readonly id: string;
  readonly medicineId: string;
  /**
   * The stored `userName` FIELD under the name the domain gives it: `label`.
   *
   * Its historical values are heterogeneous: A2 writes the recipient's name,
   * Android may write descriptive text, and the Windows inbound receipt writes
   * the authenticated administrator's profile name. It remains a label rather
   * than a globally reliable username.
   */
  readonly label: string;
  /** The stored magnitude. Never a signed quantity; see the type note above. */
  readonly quantity: number;
  readonly type: StockMovementTypeView;
  /** `DomainTimestamp` flattened to ISO-8601, so it survives `structuredClone`. */
  readonly dateIso: string;
  /**
   * Who PERFORMED the movement (`stock_logs.uid`).
   *
   * D3: A2 stores the employee receiving an order, while inbound receipts store
   * the administrator who recorded them. It is exposed as `actorUid` for that
   * reason, and the renderer displays it as an identifier only.
   */
  readonly actorUid: string | null;
  /** The `order_requests/{id}` that caused the movement; `null` when absent. */
  readonly requestId: string | null;
  /** The `orders/{id}` the movement came from; `null` when absent. */
  readonly orderId: string | null;
}

/**
 * `settings/app` (the one fixed document id, never `settings/schedule`).
 *
 * `configured` says whether the document actually exists. When it is `false`
 * the four rule-bearing values are the A2 fallbacks the Stage 6 processing step
 * would itself apply, so the UI shows what will actually be enforced instead of
 * blank fields.
 */
interface AppSettingsView {
  readonly minDaysBetweenOrders: number;
  readonly maxDailyOrders: number;
  readonly allowFridayOrders: boolean;
  readonly startTime: string;
  readonly endTime: string;
  readonly assistantId: string;
  readonly configured: boolean;
}

/**
 * The editable settings a manager may send back to `settings/app`.
 *
 * Only the four fields the Windows model actually enforces are editable:
 * `minDaysBetweenOrders`, `allowFridayOrders`, `startTime` and `endTime`.
 * `maxDailyOrders` and `assistantId` are dead in the Windows processing model
 * and are never sent back - they are display-only on the read side.
 */
interface AppSettingsViewDraft {
  readonly minDaysBetweenOrders: number;
  readonly allowFridayOrders: boolean;
  readonly startTime: string;
  readonly endTime: string;
}

/**
 * The verdict of one Stage 6 processing attempt.
 *
 * `rejected` and `already-processed` are SUCCESSES of the operation, not errors:
 * A2 commits a `failed` marker for a business refusal and writes NOTHING at all
 * for an already-processed request. Only a thrown error (a rules denial, a
 * conflict, a transport failure) produces a failed `ApplicationResult` - which
 * is exactly the distinction docs/stage6-order-processing.md preserves.
 */
type OrderProcessingOutcomeView =
  | OrderProcessingProcessedView
  | OrderProcessingRejectedView
  | OrderProcessingAlreadyProcessedView;

/** W1-W5 committed in one transaction. */
interface OrderProcessingProcessedView {
  readonly outcome: 'processed';
  readonly orderId: string;
  readonly reason: null;
  readonly status: null;
}

/** A business rule refused the request; the `failed` marker was committed. */
interface OrderProcessingRejectedView {
  readonly outcome: 'rejected';
  readonly orderId: null;
  /** A2's user-facing text. Never a technical field path. */
  readonly reason: string;
  readonly status: null;
}

/** Zero writes: the request was not `pending` (idempotency). */
interface OrderProcessingAlreadyProcessedView {
  readonly outcome: 'already-processed';
  readonly orderId: null;
  readonly reason: null;
  /** The raw stored status, `''` when the field was absent. */
  readonly status: string;
}
