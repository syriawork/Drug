/// <reference path="./domain-view.d.ts" />

/**
 * Single source of truth for the renderer <-> main-process contract.
 *
 * This file contains TYPES ONLY (no runtime code, no imports) so it can be
 * included by both builds:
 *   - the Node-side build  (electron/main.ts, electron/preload.ts, tests/)
 *   - the renderer build   (src/renderer/renderer.ts, via a triple-slash reference)
 *
 * Everything the renderer is allowed to know about the main process is declared
 * here. The renderer never talks to Electron, Node.js or Firestore directly.
 */

/** Payload returned by the main process for the application status request. */
interface AppStatusPayload {
  /** Machine readable state of the application runtime. */
  readonly state: 'ready';
  /** Arabic heading, e.g. "حالة التطبيق". */
  readonly heading: string;
  /** Arabic status label, e.g. "يعمل". */
  readonly label: string;
  readonly appName: string;
  readonly version: string;
  readonly electronVersion: string;
  readonly nodeVersion: string;
  readonly locale: string;
  readonly rtl: boolean;
  /** ISO-8601 timestamp of the moment the main process started. */
  readonly startedAtIso: string;
}

/** Safe authentication state delivered to the renderer. Sensitive tokens are NEVER exposed. */
interface SafeAuthState {
  readonly authenticated: boolean;
  readonly uid: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
  /** ISO-8601 expiration timestamp of the current ID token (if authenticated). */
  readonly expirationTimeIso: string | null;
  /**
   * Stage 7: the display name the AUTHENTICATED BACKEND already established.
   *
   * Optional because the Stage 2 service that produces `SafeAuthState` knows
   * nothing about Firestore; the Stage 7 application layer always populates it
   * (with `null` when it could not be established). It is never guessed from
   * the email and never derived from renderer input.
   */
  readonly displayName?: string | null;
  /**
   * Stage 7: `users/{uid}.role` read through the signed-in user's OWN token.
   *
   * ADVISORY ONLY - a UI affordance, never an authorization input. firestore.rules
   * remains the only authority; a local role check can neither grant nor deny a
   * single Firestore operation.
   */
  readonly role?: UserRoleView | null;
}

/** Input required from the renderer to perform authentication. */
interface SignInCredentials {
  readonly email: string;
  readonly password: string;
}

/** Standard error returned to renderer on auth failure. */
interface AuthErrorPayload {
  readonly code: string;
  readonly message: string;
}

/** Result of sign-in attempt delivered across IPC. */
interface SignInResult {
  readonly success: boolean;
  readonly authState: SafeAuthState;
  readonly error?: AuthErrorPayload;
}

/**
 * Stage 7 - the closed set of failure kinds the UI may ever be told about.
 *
 * The renderer receives this code and a fixed Arabic sentence, and NOTHING
 * else: no stack trace, no document path, no raw Firestore wire error, no
 * server message. A closed set is what makes the boundary reviewable - an
 * unlisted failure has to become `INTERNAL_ERROR`, never a leak.
 */
type ApplicationErrorCode =
  /** The credentials were refused, or no session exists. */
  | 'AUTHENTICATION_FAILED'
  /** firestore.rules answered 401/403, or the session vanished mid-call. */
  | 'AUTHORIZATION_DENIED'
  /** The caller's input or the stored data violates a rule. */
  | 'VALIDATION_FAILED'
  /** The document does not exist. */
  | 'NOT_FOUND'
  /** Transport, network, timeout or configuration failure. */
  | 'INFRASTRUCTURE_FAILURE'
  /** A transaction kept aborting: someone else changed the data first. */
  | 'CONCURRENCY_CONFLICT'
  /** Anything the Main process could not classify. Fails closed. */
  | 'INTERNAL_ERROR';

/** The ONLY error shape that crosses the IPC bridge. */
interface ApplicationErrorPayload {
  readonly code: ApplicationErrorCode;
  /** A fixed Arabic sentence chosen by the code - never an internal message. */
  readonly message: string;
  /** True when repeating the identical call could plausibly succeed. */
  readonly retryable: boolean;
}

/** The success arm of the application result envelope. */
interface ApplicationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

/** The failure arm of the application result envelope. */
interface ApplicationFailure {
  readonly ok: false;
  readonly error: ApplicationErrorPayload;
}

/**
 * Stage 7 - the single result shape every application operation returns.
 *
 * WHY A RESULT AND NOT A THROWN ERROR
 * Electron serialises a rejected `invoke` by copying the Error's own enumerable
 * properties, which in practice means the renderer can receive a message it was
 * never meant to see. Returning a value instead makes it structurally
 * impossible for an internal failure to escape: `ipcMain.handle` resolves with
 * exactly the bytes the application layer chose.
 */
type ApplicationResult<T> = ApplicationSuccess<T> | ApplicationFailure;

/** Arguments of `orders.process`. The id is the ONLY thing the renderer supplies. */
interface ProcessOrderRequestInput {
  readonly requestId: string;
}

/** Stage 19: selects one order for its read-only stock-movement detail. */
interface GetStockLogsByOrderInput {
  readonly orderId: string;
}

/**
 * Stage 9 - the ONE administrative transition the UI may request.
 *
 * `approve` and `reject` are two NAMED intents rather than a free-form
 * `status: string`, because the repository contract exposes exactly those two
 * operations. Accepting a status value would let the renderer name a third
 * state the domain does not define, which is exactly the kind of improvisation
 * the Stage 5B contract was written to prevent.
 */
type UserApprovalChange = 'approve' | 'reject';

/** Granting or revoking the single-order exception, as two named intents. */
type UserExceptionChange = 'grant' | 'revoke';

/**
 * Stage 9 - a partial user update.
 *
 * WHY THIS IS NOT A `User` OBJECT
 * A whole-document payload would be an unrestricted write: it would invite the
 * renderer to change `role`, `employeeId` or the `lastOrder*` summary, all of
 * which the repository contract deliberately refuses to expose. Naming only the
 * three permitted transitions makes an unsupported edit unrepresentable rather
 * than merely discouraged.
 *
 * Every field is `| null` and `null` means "not part of this update", so a
 * partial edit is expressed by omission rather than by sending the current
 * value back and hoping nothing changes.
 *
 * WHAT IS DELIBERATELY ABSENT
 *  - `role`         - the Stage 5B contract provides no `setUserRole`
 *  - `employeeId`   - the Stage 5B contract marks it FROZEN
 *  - `lastOrder*`   - owned by the Stage 6 processing transaction
 *  - `delete`       - not required by the design, and destructive
 *
 * firestore.rules grants `isAdmin()` a wider power than this. Exposing only what
 * the repository and domain already justify is the point: the UI cannot be used
 * to reach a field the architecture has not reviewed.
 */
interface UpdateUserInput {
  /** The target profile. Never interpolated into a document path unchecked. */
  readonly uid: string;
  /** A new display name. Must be non-blank; the trim happens in Main. */
  readonly name?: string | null;
  readonly approval?: UserApprovalChange | null;
  readonly exception?: UserExceptionChange | null;
}

/**
 * Stage 10 - the ONE medicine edit.
 *
 * Two fields, both required. There is no optional part, because there is only
 * one thing this architecture can safely change about a medicine: the per-order
 * cap.
 *
 * WHY `stock`, `totalInward` AND `totalOutward` ARE NOT HERE
 * They are INVENTORY, not profile data. Every movement of them on Android also
 * writes a `stock_logs` row, and the Windows `StockLogsRepository` contract has
 * no append operation - so an editor could change inventory that no report could
 * reconcile. `stock` is in any case maintained by the Stage 6 processing
 * transaction, which writes it as an ABSOLUTE value computed from a read inside
 * the same transaction; a hand-edited value would be overwritten by the next
 * order and would misrepresent the position in the meantime.
 *
 * WHY `name` IS NOT HERE
 * Android has no rename-medicine operation. A name is written once, at creation.
 */
interface UpdateMedicineInput {
  /** The target medicine. Pattern-checked before it can reach a path. */
  readonly medicineId: string;
  /**
   * The new per-order cap: a WHOLE number.
   *
   * NO RANGE IS ASSERTED, and that is deliberate. The mobile admin screen writes
   * whatever `toIntOrNull()` accepts with no bound, and the Cloud Functions
   * processor only compares against the cap, so declaring a limit here would make
   * this client enforce a policy its sibling does not and would refuse legitimate
   * edits. The Main process rejects only what the storage layer cannot represent.
   */
  readonly maxQuantity: number;
}

/**
 * Stage 11: identifies ONE order request for a single-document re-read.
 *
 * Ids only. There is no document body, no field mask, no collection name and no
 * actor - the same narrow shape `ProcessOrderRequestInput` already uses.
 */
interface GetOrderRequestInput {
  /** Pattern-checked in the Main process before it can reach a document path. */
  readonly requestId: string;
}

/** Stage 16: employee intent, with no identity or storage-controlled fields. */
interface SubmitOrderRequestInput {
  readonly items: readonly {
    readonly medicineId: string;
    readonly quantity: number;
  }[];
}

/**
 * The complete (and intentionally minimal) API surface exposed to the renderer
 * through the preload bridge. Adding anything here is a deliberate security
 * decision and must be reviewed.
 *
 * Stage 7 rules for every member below:
 *  - NAMED OPERATIONS ONLY. There is no `invoke`, no channel parameter, and no
 *    way to name a channel at runtime, so the renderer cannot reach a handler
 *    that is not on this list.
 *  - NO TOKENS AND NO RAW DATA ACCESS. Nothing here returns a token, a document
 *    path, a Firestore wire value, or a way to perform a raw write.
 *  - THE RENDERER SUPPLIES IDS AND NOTHING ELSE. `orders.process` takes one
 *    request id; it cannot submit a document, a mask, a field path or a write.
 *  - EVERY DATA OPERATION ANSWERS WITH `ApplicationResult`, never by throwing.
 */
interface DrugManagerApi {
  readonly apiVersion: string;
  getAppStatus(): Promise<AppStatusPayload>;
  auth: {
    signIn(credentials: SignInCredentials): Promise<SignInResult>;
    signOut(): Promise<void>;
    getState(): Promise<SafeAuthState>;
  };
  users: {
    list(): Promise<ApplicationResult<readonly UserListItemView[]>>;
    /**
     * Stage 9: applies one partial administrative update.
     *
     * The result is a bare success arm: the write itself is the answer. The
     * renderer re-reads `list()` afterwards rather than trusting a locally
     * patched copy, so what it displays is always what the server actually
     * stored - including the `lastOrder*` fields the write deliberately leaves
     * untouched.
     */
    update(input: UpdateUserInput): Promise<ApplicationResult<null>>;
  };
  medicines: {
    list(): Promise<ApplicationResult<readonly MedicineListItemView[]>>;
    /**
     * Stage 10: sets `maxQuantity`, the per-order cap.
     *
     * This is the only medicine write the architecture supports. `stock`,
     * `totalInward` and `totalOutward` are absent from the input type on
     * purpose: on Android each of those moves also writes a `stock_logs` audit
     * row, and Windows has no way to write one. `name` is absent because Android
     * has no rename operation at all.
     */
    updateMaxQuantity(input: UpdateMedicineInput): Promise<ApplicationResult<null>>;
    /**
     * Stage 15: records an INBOUND receipt and its `stock_logs` row atomically.
     *
     * The ONLY inventory write either client can perform from a Windows screen, and
     * it moves stock rather than editing a policy value. Two things are deliberate:
     *
     *  - the input is TWO keys. `stock`, `totalInward`, `totalOutward`, `name`,
     *    `medicineName`, `type` and `uid` are unreachable: the totals are computed
     *    in Main from the stock read inside the transaction, the medicine name and
     *    the actor are read from the session and the document, and the direction is
     *    fixed to `inward`. There is no way to express an OUTWARD movement here.
     *  - the audit row is not a second call. It is written inside the same
     *    transaction, so a receipt that happened and a log that was not filed cannot
     *    both be true - which is the guarantee the Stage 5B `MedicinesRepository`
     *    contract has always refused to trade away.
     */
    addInboundStock(input: AddInboundStockInput): Promise<ApplicationResult<InboundStockReceiptView>>;
  };
  orderRequests: {
    list(): Promise<ApplicationResult<readonly OrderRequestListItemView[]>>;
    /**
     * Stage 11: re-reads ONE request.
     *
     * Used after a processing attempt, when the only question that matters is what
     * the server actually stored. It is authoritative even when the request has
     * just left `pending` and would no longer appear in the windowed `list()`.
     */
    get(input: GetOrderRequestInput): Promise<ApplicationResult<OrderRequestListItemView>>;
    /** Stage 16: creates a pending request from medicine ids and quantities only. */
    submit(input: SubmitOrderRequestInput): Promise<ApplicationResult<OrderRequestSubmissionView>>;
  };
  settings: {
    get(): Promise<ApplicationResult<AppSettingsView>>;
  };
  /**
   * Stage 14: the inventory movement audit trail.
   *
   * READ-ONLY, and there is no companion verb. `stock_logs` rows are written by
   * the Stage 6 transaction and by the mobile app; this namespace has no create,
   * update, delete or append operation to offer, so a stock movement cannot be
   * written from a Windows screen even in principle.
   *
   * NO PARAMETER, for the same reason `orders.list` takes none: the renderer
   * cannot narrow the read to a medicine, an order or a period. The rows are
   * exactly what firestore.rules decided this caller may see.
   *
   * `quantity` is a POSITIVE MAGNITUDE for both directions and `type` alone
   * carries the sign, so a consumer that summed this field without reading `type`
   * would report every outward movement as an inflow. Nothing here pre-sums it.
   */
  stockLogs: {
    list(): Promise<ApplicationResult<readonly StockLogView[]>>;
    listByOrder(input: GetStockLogsByOrderInput): Promise<ApplicationResult<readonly StockLogView[]>>;
  };
  orders: {
    /**
     * Stage 12: the read-only orders history.
     *
     * NO PARAMETER, deliberately. Every other data operation takes at most an id;
     * this one cannot even be pointed at a document, a field or a filter, so the
     * whole permitted history is what the rules decide the caller may see.
     */
    list(): Promise<ApplicationResult<OrderHistoryPageView>>;
    /** Stage 23: advances Main's existing cursor; accepts no renderer-controlled query data. */
    loadMore(): Promise<ApplicationResult<OrderHistoryPageView>>;
    /** Stage 17: payload-free history scoped by the trusted Main-process UID. */
    myHistory(): Promise<ApplicationResult<readonly PersonalOrderHistoryItemView[]>>;
    /**
     * The Stage 6 processing write. It takes ONE request id and nothing else: no
     * document, no field mask, no collection, no actor. Everything else is
     * decided in the Main process from the session and the domain rules.
     */
    process(input: ProcessOrderRequestInput): Promise<ApplicationResult<OrderProcessingOutcomeView>>;
  };
}