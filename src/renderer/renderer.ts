/// <reference path="../shared/ipc-contract.d.ts" />

/**
 * Stage 8 - the renderer.
 *
 * WHAT THIS FILE IS ALLOWED TO DO
 * Read the DOM, and call the NAMED Stage 7 preload API. That is the whole list.
 *
 * WHAT IT IS NOT ALLOWED TO DO - this is the security boundary of Stage 8
 *  - No backend access. The backend is reached only from the Main process.
 *  - No raw storage access. The transport is behind the Stage 7 services.
 *  - No tokens. It never reads, stores or manipulates one; the token lives in the
 *    Main process and the only thing that reaches this file is `SafeAuthState`.
 *  - No Node.js, no `require`, no `process`, no filesystem.
 *  - No arbitrary IPC. Every call is a named method of the typed bridge, and the
 *    bridge has no channel parameter with which to redirect one.
 *  - No authorization decision. `role` is DISPLAYED and nothing else: no control
 *    is hidden, enabled or disabled because of it. The backend decides.
 *  - No business rules. The renderer computes no eligibility, no stock and no
 *    schedule - those belong to the domain and to the server-side rules.
 *  - No invented data. There are no placeholder statistics, no sample rows and
 *    no mock numbers; the dashboard shows only real state.
 *
 * WHY THIS IS ONE FILE WITH NO IMPORTS
 * The Stage 3 architecture guard asserts the compiled renderer bundle contains
 * no `import ` and no `require(`. A module-based renderer would emit `import`
 * statements and fail that guard, so the shell logic lives in a single classic
 * script - the same deliberate constraint as the Stage 3 foundation.
 *
 * THE STATE MODEL
 * Five explicit states, mirrored onto `<body data-ui-state>` so that the current
 * state is observable from outside the script (by the tests, and by CSS):
 *
 *   initializing    reading the safe authentication state for the first time
 *   unauthenticated the login form is shown
 *   authenticating  a sign-in is in flight; the form is locked
 *   authenticated    the manager shell is shown
 *   signing-out     a sign-out is in flight
 */

/** The five states the shell can be in. Nothing else is representable. */
type UiState = 'initializing' | 'unauthenticated' | 'authenticating' | 'authenticated' | 'signing-out';

/** A navigation entry. `implemented` marks the single working view. */
interface NavEntry {
  readonly view: string;
  readonly label: string;
  readonly implemented: boolean;
}

function invalidateOrderHistoryRequests(): void {
  ordersHistoryRequestGeneration += 1;
  ordersHistoryInFlight = false;
  ordersHistoryLoadMoreInFlight = false;
}

function isCurrentOrderHistoryRequest(generation: number, ownerUid: string | null): boolean {
  return generation === ordersHistoryRequestGeneration
    && ownerUid !== null
    && currentAuthState?.authenticated === true
    && currentAuthState.uid === ownerUid;
}

function mergeOrderHistoryPages(
  existing: readonly OrderHistoryItemView[],
  incoming: readonly OrderHistoryItemView[],
): readonly OrderHistoryItemView[] {
  const byId = new Map<string, OrderHistoryItemView>();
  for (const order of existing) {
    if (!byId.has(order.id)) {
      byId.set(order.id, order);
    }
  }
  for (const order of incoming) {
    if (!byId.has(order.id)) {
      byId.set(order.id, order);
    }
  }
  return Object.freeze([...byId.values()]);
}

function setOrderHistoryDataState(): void {
  if (loadedOrderHistory === null) {
    return;
  }
  const currentState = document.getElementById(ELEMENT_IDS.ordersHistoryState)
    ?.getAttribute('data-view-state');
  if (currentState === 'loading' || currentState === 'refreshing' || currentState === 'error') {
    return;
  }
  const visible = visibleOrderHistory();
  if (loadedOrderHistory.length === 0) {
    setOrderHistoryState('empty', 'لا توجد طلبات محمّلة بعد.');
  } else if (visible.length === 0) {
    setOrderHistoryState('empty', 'لا توجد طلبات مطابقة للتصفية ضمن الطلبات المحمّلة.');
  } else {
    setOrderHistoryState('ready', '');
  }
}

/**
 * Stage 9 - the users module.
 *
 * WHAT THIS MODULE IS ALLOWED TO DO
 * Read the users the Stage 7 bridge already returns, filter that list locally, and
 * ask the Main process to apply ONE of the three transitions the repository
 * contract exposes.
 *
 * WHAT IT IS NOT ALLOWED TO DO
 *  - No backend access. `users.list()` and `users.update()` are named Stage 7
 *    operations; the wire format never reaches this file.
 *  - No whole-document write. The payload is `{uid, name?, approval?, exception?}`
 *    and nothing else, so `role`, `employeeId` and the `lastOrder*` summary are not
 *    merely ignored - they cannot be expressed.
 *  - No authorization decision. `role` is DISPLAYED, and it also decides whether
 *    the edit buttons are enabled - purely so an employee does not press a button
 *    the server will refuse. The refusal is still the server's: the Stage 9
 *    emulator suite proves an employee gets 403 from firestore.rules even when the
 *    UI let them try.
 *  - No invented data. Every cell comes from a real `UserListItemView` field, and
 *    an unknown backend value renders as "غير محدد" rather than being
 *    reinterpreted or crashing the row.
 *
 * WHY SEARCH IS LOCAL
 * The list is already fully loaded, so filtering it needs no query at all. Sending
 * a query per keystroke would add round trips, and firestore.rules would refuse a
 * filtered list for anyone but an admin anyway - rules are not filters.
 */

/** The closed set of visible page states for the users module. */
type UsersViewState = 'idle' | 'loading' | 'refreshing' | 'ready' | 'empty' | 'error' | 'saving';

/** Arabic labels for the closed domain sets. */
const USER_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
});

/** Arabic labels for the order-status summary. */
const LAST_ORDER_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: 'قيد الانتظار',
  accepted: 'مقبول',
  rejected: 'مرفوض',
});

/** Shown for any value the domain does not define. */
const UNKNOWN_LABEL = 'غير محدد';

/** The loaded users. `null` until the first load has completed. */
let loadedUsers: readonly UserListItemView[] | null = null;

/** The user's current search term. */
let searchTerm = '';

/** The user whose details are open, or `null` when the dialog is closed. */
let selectedUser: UserListItemView | null = null;

/** Guards the refresh button against a second overlapping request. */
let usersRequestInFlight = false;

/**
 * Stage 10 - the medicines module state.
 *
 * The INVENTORY RULE, stated once so it is not re-derived per cell:
 * `stock` is rendered EXACTLY as stored and is never computed from
 * `totalInward - totalOutward`. The audit established that `stock` is written as
 * an ABSOLUTE value by the Stage 6 processing transaction, while the two
 * counters move on different occasions (a counter moves when an order is
 * accepted or rejected; stock moves when the order is processed). Their
 * difference is therefore not a valid inventory, and presenting it as one would
 * contradict the order-processing engine that owns the value.
 */
let loadedMedicines: readonly MedicineListItemView[] | null = null;
let medicineSearchTerm = '';
let selectedMedicine: MedicineListItemView | null = null;
let medicinesRequestInFlight = false;
let medicineSaveInFlight = false;
// Stage 15: a SEPARATE in-flight guard from the `maxQuantity` save. Two writes
// sharing one flag would let a receipt be blocked by an unrelated cap edit, and
// worse, would let a cap save be blocked by a receipt in progress - neither of
// which is a state either write has any business knowing about.
let medicineInboundInFlight = false;

/**
 * Stage 11 - the order-requests module state.
 *
 * WHAT THIS MODULE IS NOT ALLOWED TO DO, stated once so it is not re-decided per
 * cell. Everything below is presentation of values the Main process already
 * produced. This file must NOT:
 *
 *  - compute stock, or any stock-derived figure;
 *  - sum, total, average or aggregate quantities, INCLUDING collapsing duplicate
 *    medicine ids (Stage 6 aggregates, and only Stage 6);
 *  - apply any business rule - eligibility, approval, exception, the monthly
 *    interval, the Friday rule, the time window, or the per-medicine cap;
 *  - decide or even predict an outcome before the server has answered;
 *  - mark a request processed by any local means.
 *
 * The ONLY write-shaped thing this file can do is forward a request id to
 * `api.orders.process`, which the Main process hands to the Stage 6 service.
 * `items.length` below is therefore a COUNT OF ROWS SHOWN, not a quantity total,
 * and it is used for exactly that and nothing else.
 */
let loadedOrders: readonly OrderRequestListItemView[] | null = null;

// ---------------------------------------------------------------------------
// Stage 12 - the orders HISTORY (read-only audit surface).
//
// DISTINCT FROM THE STAGE 11 QUEUE ABOVE, and deliberately so: `loadedOrders`
// holds `order_requests` (what is waiting to be processed) while
// `loadedOrderHistory` holds `orders` (what already exists). Mixing the two in
// one cache would make "nothing to process" look like "no orders", so they are
// two modules with two caches.
// ---------------------------------------------------------------------------

/** The loaded `orders`, or `null` before the first successful read. */
let loadedOrderHistory: readonly OrderHistoryItemView[] | null = null;

/** The search term; LOCAL only - typing never triggers a transport call. */
let ordersHistorySearchTerm = '';

/** `all`, or one of the three stored `orders.status` values. */
let ordersHistoryStatusFilter = 'all';

/** The row whose details are open, or `null` when the dialog is closed. */
let selectedOrderHistory: OrderHistoryItemView | null = null;
/** Invalidates a late order-movement response when the dialog selection changes. */
let orderHistoryMovementsGeneration = 0;

/** One in-flight `list`, so a double refresh cannot double-read the backend. */

// Stage 13: the settings read is cached like every other page, and dropped on
// sign-out for the same reason: it belongs to the session that ended.
let loadedAppSettings: AppSettingsView | null = null;
let settingsInFlight = false;
let settingsSaveInFlight = false;
let ordersHistoryInFlight = false;
let ordersHistoryLoadMoreInFlight = false;
let ordersHistoryHasMore = false;
let ordersHistoryLoadMoreMessage = '';
let ordersHistoryLoadMoreRetryable = false;
let ordersHistoryRequestGeneration = 0;
// Stage 17: a separate owner-scoped cache; it never shares the manager history.
let loadedMyOrderHistory: readonly PersonalOrderHistoryItemView[] | null = null;
let myOrderHistoryInFlight = false;
let myOrderHistoryViewState: UsersViewState = 'idle';
let myOrdersSearchTerm = '';
let myOrdersStatusFilter = 'all';

// Stage 14: the movement audit rows, cached like every other page and dropped on
// sign-out for the same reason: the audit trail belongs to the session that ended.
let loadedStockMovements: readonly StockLogView[] | null = null;
let stockMovementsInFlight = false;
let stockSearchTerm = '';
/** `all`, `inward` or `outward` - the three values the direction select offers. */
let stockDirectionFilter = 'all';

// Stage 16: a local draft only. The Main process resolves names and identity and
// the repository owns the generated request metadata.
let requestMedicines: readonly MedicineListItemView[] | null = null;
let requestMedicinesInFlight = false;
let requestMedicinesFailed = false;
let requestItems: { readonly medicineId: string; readonly quantity: number }[] = [];
let requestSubmissionInFlight = false;
let requestStatusInFlight = false;
let submittedRequestId: string | null = null;

/**
 * The three `orders.status` values the domain defines.
 *
 * A translation table, NOT an authorization or lifecycle table: it maps a stored
 * value to Arabic and nothing else. `orders.status` belongs to the mobile app's
 * own order flow and is deliberately NOT the Stage 11 request status.
 */
const ORDER_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: 'قيد الانتظار',
  accepted: 'مقبول',
  rejected: 'مرفوض',
});

/** The filter values the status select accepts; anything else means "all". */
const ORDER_HISTORY_FILTER_VALUES: ReadonlySet<string> = new Set<string>([
  'all', 'pending', 'accepted', 'rejected',
]);
/** Arabic labels for the two booleans `settings/app` carries. */
const BOOLEAN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  true: 'نعم',
  false: 'لا',
});
let ordersSearchTerm = '';
let ordersStatusFilter = 'all';
let selectedOrder: OrderRequestListItemView | null = null;
let ordersRequestInFlight = false;
let orderProcessInFlight = false;

/** Arabic labels for the three request statuses the domain defines. */
const ORDER_REQUEST_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: 'قيد الانتظار',
  processed: 'تمت المعالجة',
  failed: 'فشل',
});

/** The three values the status filter accepts; anything else means "no filter". */
const ORDER_STATUS_FILTER_VALUES: ReadonlySet<string> = new Set<string>(['all', 'pending', 'processed', 'failed']);

/** Guards the dialog actions against a second overlapping write. */
let userSaveInFlight = false;

/**
 * Normalises text for SEARCH comparison only.
 *
 * Stored values are never mutated. Three classes of difference are folded away so
 * that an Arabic name matches however it was typed:
 *  - Arabic diacritics (tashkeel) and the tatweel, which are frequently omitted;
 *  - the alef / yeh / teh-marbuta spelling variants of one letter;
 *  - Arabic-Indic digits against ASCII, so searching `06` finds `٠٦`.
 * Latin text is lowercased for case-insensitive matching.
 */
function normalizeForSearch(value: string): string {
  return value
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, '\u0627')
    .replace(/ى/g, '\u064A')
    .replace(/ؤ/g, '\u0648')
    .replace(/ئ/g, '\u064A')
    .replace(/ة/g, '\u0647')
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the user matches the current search term. */
function matchesSearch(user: UserListItemView, needle: string): boolean {
  if (needle.length === 0) {
    return true;
  }
  return (
    normalizeForSearch(user.name).includes(needle)
    || normalizeForSearch(user.employeeId).includes(needle)
    || normalizeForSearch(user.uid).includes(needle)
    // The month is searchable too, so "who ordered in 06-2026?" is answerable
    // without a second screen. This is the D1-NORMALISED display value, which
    // means an ASCII search finds a document that stores Arabic-Indic digits.
    || normalizeForSearch(user.lastOrderMonthYearDisplay ?? '').includes(needle)
  );
}

/** The loaded users filtered by the current term, never a new query. */
function visibleUsers(): readonly UserListItemView[] {
  if (loadedUsers === null) {
    return [];
  }
  const needle = normalizeForSearch(searchTerm);
  return loadedUsers.filter((user) => matchesSearch(user, needle));
}

/** Translates a closed domain value into Arabic, degrading safely. */
function labelOf(table: Readonly<Record<string, string>>, value: string | null): string {
  if (value === null || value === '') {
    return UNKNOWN_LABEL;
  }
  return table[value] ?? `${UNKNOWN_LABEL} (${value})`;
}

/**
 * Stage 10: the medicines currently on screen after the local filter.
 *
 * `medicineSearchTerm` is matched against the NAME only. The id is deliberately
 * not searched: an operator looks for a drug by its name, and offering an id
 * search would invite treating a storage identifier as a business key.
 */
function visibleMedicines(): readonly MedicineListItemView[] {
  if (loadedMedicines === null) {
    return [];
  }
  const needle = normalizeForSearch(medicineSearchTerm);
  if (needle.length === 0) {
    return loadedMedicines;
  }
  return loadedMedicines.filter((medicine) => normalizeForSearch(medicine.name).includes(needle));
}

/**
 * The navigation entries.
 *
 * `dashboard` and `users` are implemented; the rest exist so the shell has its
 * final shape, and each renders a "later stage" notice rather than pretending to
 * work. A placeholder entry performs NO data operation: it has nothing real to
 * call, so calling anything would only teach a later stage a wrong pattern.
 */
const NAV_ENTRIES: readonly NavEntry[] = Object.freeze([
  { view: 'dashboard', label: 'لوحة التحكم', implemented: true },
  { view: 'users', label: 'المستخدمون', implemented: true },
  { view: 'medicines', label: 'الأدوية', implemented: true },
  { view: 'orders', label: 'طلبات الأدوية', implemented: true },
  { view: 'orders-history', label: 'سجل الطلبات', implemented: true },
  { view: 'my-orders', label: 'طلباتي المنفَّذة', implemented: true },
  { view: 'request-submit', label: 'إرسال طلب أدوية', implemented: true },
  { view: 'stock', label: 'سجل حركة المخزون', implemented: true },
  { view: 'settings', label: 'الإعدادات', implemented: true },
]);

/**
 * Arabic labels for the advisory `role` the safe auth state may carry.
 *
 * This is a translation table, NOT an authorization table. The value arrives from
 * the backend's own profile read and is shown for information only; an unknown or
 * absent value renders as a neutral label rather than being interpreted.
 */
const ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  admin: 'مدير النظام',
  assistant: 'مساعد',
  employee: 'موظف',
});

/** Shown when the preload bridge itself is unreachable. */
const BRIDGE_UNAVAILABLE_MESSAGE = 'تعذر الوصول إلى جسر الاتصال الداخلي. يُرجى إعادة تشغيل التطبيق.';

/** Shown when the safe authentication state could not be read. */
const STATE_UNAVAILABLE_MESSAGE = 'تعذر قراءة حالة الجلسة من العملية الرئيسية. يُرجى إعادة تشغيل التطبيق.';

/** Element ids the shell reads. Declared once so a rename breaks loudly. */
const ELEMENT_IDS = Object.freeze({
  loginView: 'login-view',
  loginForm: 'login-form',
  loginEmail: 'login-email',
  loginPassword: 'login-password',
  loginSubmit: 'login-submit',
  loginError: 'login-error',
  loginErrorMessage: 'login-error-message',
  passwordToggle: 'password-toggle',
  shellView: 'shell-view',
  shellUserName: 'shell-user-name',
  shellUserEmail: 'shell-user-email',
  shellUserRole: 'shell-user-role',
  logoutButton: 'logout-button',
  navList: 'nav-list',
  dashboardView: 'dashboard-view',
  dashboardUserName: 'dashboard-user-name',
  dashboardUserEmail: 'dashboard-user-email',
  placeholderView: 'placeholder-view',
  placeholderTitle: 'placeholder-title',
  statusCard: 'status-card',
  statusValue: 'status-value',
  infoList: 'info-list',
  // Stage 9 - the users module.
  usersView: 'users-view',
  usersRows: 'users-rows',
  usersCount: 'users-count',
  usersSearch: 'users-search-input',
  usersRefresh: 'users-refresh',
  usersState: 'users-state',
  usersStateMessage: 'users-state-message',
  usersRetry: 'users-retry',
  userDialog: 'user-dialog',
  userDialogClose: 'user-dialog-close',
  userDialogError: 'user-dialog-error',
  userDialogErrorMessage: 'user-dialog-error-message',
  userDetailName: 'user-detail-name',
  userDetailRole: 'user-detail-role',
  userDetailEmployeeId: 'user-detail-employee-id',
  userDetailStatus: 'user-detail-status',
  userDetailLastOrder: 'user-detail-last-order',
  userDetailException: 'user-detail-exception',
  userSave: 'user-save',
  userApprove: 'user-approve',
  userReject: 'user-reject',
  userGrantException: 'user-grant-exception',
  userRevokeException: 'user-revoke-exception',
  // Stage 10 - the medicines module.
  medicinesView: 'medicines-view',
  medicinesRows: 'medicines-rows',
  medicinesCount: 'medicines-count',
  medicinesSearch: 'medicines-search-input',
  medicinesRefresh: 'medicines-refresh',
  medicinesState: 'medicines-state',
  medicinesStateMessage: 'medicines-state-message',
  medicinesRetry: 'medicines-retry',
  medicineDialog: 'medicine-dialog',
  medicineDialogClose: 'medicine-dialog-close',
  medicineDialogError: 'medicine-dialog-error',
  medicineDialogErrorMessage: 'medicine-dialog-error-message',
  medicineDetailName: 'medicine-detail-name',
  medicineDetailStock: 'medicine-detail-stock',
  medicineDetailInward: 'medicine-detail-inward',
  medicineDetailOutward: 'medicine-detail-outward',
  medicineDetailMaxQuantity: 'medicine-detail-max-quantity',
  medicineSave: 'medicine-save',
// Stage 15: the inbound receipt. DISPLAY/AFFER controls only - there is
// deliberately no id for a "confirm receipt", no balance field and no direction
// control, because the Main process decides all three.
medicineDetailInboundQuantity: 'medicine-detail-inbound-quantity',
medicineAddInbound: 'medicine-add-inbound',
  // Stage 11 - the order-requests module.
  ordersView: 'orders-view',
  // Stage 16 - employee request submission.
  requestSubmitView: 'request-submit-view',
  requestSubmitState: 'request-submit-state',
  requestSubmitStateMessage: 'request-submit-state-message',
  requestSubmitRetry: 'request-submit-retry',
  requestStatusPanel: 'request-status-panel',
  requestStatusRequestId: 'request-status-request-id',
  requestStatusMessage: 'request-status-message',
  requestStatusRefresh: 'request-status-refresh',
  requestMedicineSelect: 'request-medicine-select',
  requestQuantity: 'request-quantity',
  requestAddItem: 'request-add-item',
  requestItems: 'request-items',
  requestSubmit: 'request-submit',
  // Stage 12 - the orders history page.
  ordersHistoryView: 'orders-history-view',
  ordersHistoryRefresh: 'orders-history-refresh',
  ordersHistoryPrint: 'orders-history-print',
  ordersHistoryRetry: 'orders-history-retry',
  ordersHistoryLoadMore: 'orders-history-load-more',
  ordersHistoryLoadMoreState: 'orders-history-load-more-state',
  ordersHistoryCount: 'orders-history-count',
  ordersHistorySearchInput: 'orders-history-search-input',
  ordersHistoryStatusFilter: 'orders-history-status-filter',
  ordersHistoryState: 'orders-history-state',
  ordersHistoryStateMessage: 'orders-history-state-message',
  ordersHistoryRows: 'orders-history-rows',
  ordersHistoryReportTitle: 'orders-history-report-title',
  ordersHistoryReportGeneratedAt: 'orders-history-report-generated-at',
  ordersHistoryReportFilters: 'orders-history-report-filters',
  ordersHistoryReportCount: 'orders-history-report-count',
  ordersHistoryReportScope: 'orders-history-report-scope',
  ordersHistoryReportEmpty: 'orders-history-report-empty',
  // Stage 17 - the authenticated employee's own order history.
  myOrdersView: 'my-orders-view',
  myOrdersRefresh: 'my-orders-refresh',
  myOrdersPrint: 'my-orders-print',
  myOrdersRetry: 'my-orders-retry',
  myOrdersSearchInput: 'my-orders-search-input',
  myOrdersStatusFilter: 'my-orders-status-filter',
  myOrdersClearFilters: 'my-orders-clear-filters',
  myOrdersCount: 'my-orders-count',
  myOrdersState: 'my-orders-state',
  myOrdersStateMessage: 'my-orders-state-message',
  myOrdersRows: 'my-orders-rows',
  myOrdersReportTitle: 'my-orders-report-title',
  myOrdersReportGeneratedAt: 'my-orders-report-generated-at',
  myOrdersReportFilters: 'my-orders-report-filters',
  myOrdersReportCount: 'my-orders-report-count',
  myOrdersReportScope: 'my-orders-report-scope',
  myOrdersReportEmpty: 'my-orders-report-empty',
  orderHistoryDialog: 'order-history-dialog',
  orderHistoryDialogClose: 'order-history-dialog-close',
  orderHistoryDetailId: 'order-history-detail-id',
  orderHistoryDetailEmployee: 'order-history-detail-employee',
  orderHistoryDetailDate: 'order-history-detail-date',
  orderHistoryDetailMonth: 'order-history-detail-month',
  orderHistoryDetailStatus: 'order-history-detail-status',
  orderHistoryDetailException: 'order-history-detail-exception',
  orderHistoryDetailRequest: 'order-history-detail-request',
  orderHistoryDetailItems: 'order-history-detail-items',
  orderHistoryMovementsState: 'order-history-movements-state',
  orderHistoryMovementsStateMessage: 'order-history-movements-state-message',
  orderHistoryMovementsTableWrap: 'order-history-movements-table-wrap',
  orderHistoryMovementsRows: 'order-history-movements-rows',
  // Stage N - the system settings page. The four rule-bearing fields are
  // editable: minDaysBetweenOrders, allowFridayOrders, startTime, endTime.
  // maxDailyOrders and assistantId remain read-only display values.
  settingsView: 'settings-view',
  settingsRefresh: 'settings-refresh',
  settingsRetry: 'settings-retry',
  settingsState: 'settings-state',
  settingsStateMessage: 'settings-state-message',
  settingsNotConfigured: 'settings-not-configured',
  settingsMinDays: 'settings-min-days',
  settingsFriday: 'settings-friday',
  settingsStartTime: 'settings-start-time',
  settingsEndTime: 'settings-end-time',
  settingsMaxDaily: 'settings-max-daily',
  settingsAssistant: 'settings-assistant',
  settingsSave: 'settings-save',
// Stage 14: the movement audit page. DISPLAY targets only - there is deliberately
// no `stockSave` id here, because a control that could change a movement would be
// a second, unaudited way to move stock.
stockView: 'stock-view',
stockRefresh: 'stock-refresh',
stockRetry: 'stock-retry',
stockState: 'stock-state',
stockStateMessage: 'stock-state-message',
stockCount: 'stock-count',
stockSearch: 'stock-search-input',
stockDirectionFilter: 'stock-direction-filter',
stockRows: 'stock-rows',
  ordersRows: 'orders-rows',
  ordersCount: 'orders-count',
  ordersSearch: 'orders-search-input',
  ordersStatusFilter: 'orders-status-filter',
  ordersRefresh: 'orders-refresh',
  ordersRetry: 'orders-retry',
  ordersState: 'orders-state',
  ordersStateMessage: 'orders-state-message',
  orderDialog: 'order-dialog',
  orderDialogClose: 'order-dialog-close',
  orderDialogRefresh: 'order-dialog-refresh',
  orderDialogError: 'order-dialog-error',
  orderDialogErrorMessage: 'order-dialog-error-message',
  orderOutcomeMessage: 'order-outcome-message',
  orderDetailEmployee: 'order-detail-employee',
  orderDetailDate: 'order-detail-date',
  orderDetailStatus: 'order-detail-status',
  orderDetailOrderId: 'order-detail-order-id',
  orderDetailProcessedAt: 'order-detail-processed-at',
  orderDetailProcessedBy: 'order-detail-processed-by',
  orderDetailItems: 'order-detail-items',
  orderDetailFailure: 'order-detail-failure',
  orderDetailFailureMessage: 'order-detail-failure-message',
  orderProcess: 'order-process',
  orderConfirmDialog: 'order-confirm-dialog',
  orderConfirmEmployee: 'order-confirm-employee',
  orderConfirmDate: 'order-confirm-date',
  orderConfirmItems: 'order-confirm-items',
  orderConfirmItemsDetail: 'order-confirm-items-detail',
  orderConfirmCancel: 'order-confirm-cancel',
  orderConfirmAccept: 'order-confirm-accept',
});

/** Current UI state. The single source of truth for what is on screen. */
let currentState: UiState = 'initializing';

/** The safe authentication state, or `null` when nobody is signed in. */
let currentAuthState: SafeAuthState | null = null;

/** Writes text into an element when the element exists. */
function setText(elementId: string, text: string): void {
  const element = document.getElementById(elementId);
  if (element !== null) {
    element.textContent = text;
  }
}

/** Shows or hides an element through the `hidden` property. */
function setHidden(elementId: string, hidden: boolean): void {
  const element = document.getElementById(elementId);
  if (element !== null) {
    element.hidden = hidden;
  }
}

/** Enables or disables a form control. */
function setDisabled(elementId: string, disabled: boolean): void {
  const element = document.getElementById(elementId) as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | null;
  if (element !== null) {
    element.disabled = disabled;
  }
}

/**
 * Mirrors the current state onto `<body>` so CSS and tests can observe it, and
 * locks the controls that must not be used while a request is in flight.
 */
function applyState(state: UiState): void {
  currentState = state;
  document.body.dataset['uiState'] = state;

  const busy = state === 'authenticating' || state === 'signing-out';
  setDisabled(ELEMENT_IDS.loginSubmit, busy);
  setDisabled(ELEMENT_IDS.loginEmail, busy);
  setDisabled(ELEMENT_IDS.loginPassword, busy);
  setDisabled(ELEMENT_IDS.logoutButton, busy);
}

/** The typed preload bridge, or `null` when the preload script did not run. */
function getDrugManagerApi(): DrugManagerApi | null {
  const bridge = (window as unknown as { readonly drugManager?: DrugManagerApi }).drugManager;
  return bridge ?? null;
}

/**
 * Clears the password field.
 *
 * Called after every failed attempt and on sign-out. A password that survives a
 * failed sign-in is a password sitting in a DOM node for the next person at the
 * keyboard, and it is never written anywhere durable.
 */
function clearPassword(): void {
  const password = document.getElementById(ELEMENT_IDS.loginPassword) as HTMLInputElement | null;
  if (password !== null) {
    password.value = '';
  }
}

/** Returns the password input to its masked, hidden-password state. */
function resetPasswordToggle(): void {
  const password = document.getElementById(ELEMENT_IDS.loginPassword) as HTMLInputElement | null;
  const toggle = document.getElementById(ELEMENT_IDS.passwordToggle) as HTMLButtonElement | null;
  if (password !== null) {
    password.type = 'password';
  }
  if (toggle !== null) {
    toggle.textContent = 'إظهار';
    toggle.setAttribute('aria-pressed', 'false');
  }
}

/** Shows a safe Arabic message, or clears the region when `null` is given. */
function setErrorMessage(message: string | null): void {
  setText(ELEMENT_IDS.loginErrorMessage, message ?? '');
  setHidden(ELEMENT_IDS.loginError, message === null);
}

/** The best available human name for the signed-in user. */
function displayNameOf(state: SafeAuthState): string {
  const name = state.displayName;
  if (typeof name === 'string' && name.trim().length > 0) {
    return name.trim();
  }
  const email = state.email;
  return typeof email === 'string' && email.length > 0 ? email : 'مستخدم';
}

/**
 * The Arabic label for a role value, never an authorization decision.
 *
 * Takes the raw value rather than a whole view object so the same table serves
 * the signed-in user's own state and every row of the users list.
 */
function roleLabelOf(role: string | null | undefined): string {
  if (typeof role === 'string') {
    return ROLE_LABELS[role] ?? UNKNOWN_LABEL;
  }
  return UNKNOWN_LABEL;
}
/** Shows the login form and wipes every piece of state the shell was showing. */
function showLogin(message: string | null = null): void {
  invalidateOrderHistoryRequests();
  currentAuthState = null;
  // Stage 9: the cached users belong to the session that just ended, so they are
  // dropped here rather than left behind a login form.
  loadedUsers = null;
  searchTerm = '';
  selectedUser = null;
  usersRequestInFlight = false;
  userSaveInFlight = false;
  // Stage 10: the cached catalogue belongs to the session that just ended.
  loadedMedicines = null;
  medicineSearchTerm = '';
  selectedMedicine = null;
  medicinesRequestInFlight = false;
  medicineSaveInFlight = false;
  // Stage 15: the receipt's own in-flight guard and its typed quantity are reset
  // for the same reason as everything above - an in-progress receipt belongs to the
  // session that started it, and a leftover quantity would be one click away from
  // moving the next manager's inventory without them typing anything.
  medicineInboundInFlight = false;
  requestMedicines = null;
  requestMedicinesInFlight = false;
  requestMedicinesFailed = false;
  requestItems = [];
  requestSubmissionInFlight = false;
  for (const id of [
    ELEMENT_IDS.requestMedicineSelect,
    ELEMENT_IDS.requestQuantity,
  ]) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input !== null) {
      input.value = '';
    }
  }
  const requestItemRows = document.getElementById(ELEMENT_IDS.requestItems);
  if (requestItemRows !== null) {
    requestItemRows.textContent = '';
  }
  setText(ELEMENT_IDS.requestSubmitStateMessage, '');
  const requestState = document.getElementById(ELEMENT_IDS.requestSubmitState);
  requestState?.setAttribute('data-view-state', 'idle');
  setDisabled(ELEMENT_IDS.requestSubmit, true);
  const medicineRows = document.getElementById(ELEMENT_IDS.medicinesRows);
  if (medicineRows !== null) {
    medicineRows.textContent = '';
  }
  setText(ELEMENT_IDS.medicinesCount, '');
  setText(ELEMENT_IDS.medicinesSearch, '');
  setText(ELEMENT_IDS.medicineDialogErrorMessage, '');
  setText(ELEMENT_IDS.medicineDetailInboundQuantity, '');
  // Stage 11: the request queue belongs to the session that just ended, and an
  // open processing dialog would otherwise still name an employee and a list of
  // medicines behind a login form. The dialogs are CLOSED, not merely emptied,
  // so nothing about the previous session remains on screen.
  loadedOrders = null;
  ordersSearchTerm = '';
  ordersStatusFilter = 'all';
  selectedOrder = null;
  ordersRequestInFlight = false;
  orderProcessInFlight = false;
  const orderRows = document.getElementById(ELEMENT_IDS.ordersRows);
  if (orderRows !== null) {
    orderRows.textContent = '';
  }
  const orderItems = document.getElementById(ELEMENT_IDS.orderDetailItems);
  if (orderItems !== null) {
    orderItems.textContent = '';
  }
  closeOrderDialog();
  closeOrderConfirmDialog();
  setText(ELEMENT_IDS.ordersCount, '');
  setText(ELEMENT_IDS.ordersSearch, '');
  setText(ELEMENT_IDS.orderDialogErrorMessage, '');
  setText(ELEMENT_IDS.orderOutcomeMessage, '');
  setText(ELEMENT_IDS.orderDetailFailureMessage, '');
  // Stage 12: the audit trail is the most identifying data on the screen - every
  // row names an employee and the medicines they asked for. It is cleared for
  // the same reason as the queue above, and the dialog is CLOSED so no order
  // detail survives behind the login form.
  loadedOrderHistory = null;
  ordersHistorySearchTerm = '';
  ordersHistoryStatusFilter = 'all';
  ordersHistoryInFlight = false;
  ordersHistoryLoadMoreInFlight = false;
  ordersHistoryHasMore = false;
  ordersHistoryLoadMoreMessage = '';
  ordersHistoryLoadMoreRetryable = false;
  const historyRows = document.getElementById(ELEMENT_IDS.ordersHistoryRows);
  if (historyRows !== null) {
    historyRows.textContent = '';
  }
  const historyItems = document.getElementById(ELEMENT_IDS.orderHistoryDetailItems);
  if (historyItems !== null) {
    historyItems.textContent = '';
  }
  closeOrderHistoryDialog();
  setText(ELEMENT_IDS.ordersHistoryCount, '');
  setText(ELEMENT_IDS.ordersHistorySearchInput, '');
  setText(ELEMENT_IDS.ordersHistoryStateMessage, '');
  // Stage 17: personal order history is scoped to the session and is dropped
  // before the login view can reveal data from the previous account.
  loadedMyOrderHistory = null;
  myOrderHistoryInFlight = false;
  myOrderHistoryViewState = 'idle';
  myOrdersSearchTerm = '';
  myOrdersStatusFilter = 'all';
  const myOrderRows = document.getElementById(ELEMENT_IDS.myOrdersRows);
  if (myOrderRows !== null) {
    myOrderRows.textContent = '';
  }
  const myOrdersSearchInput = document.getElementById(ELEMENT_IDS.myOrdersSearchInput) as HTMLInputElement | null;
  if (myOrdersSearchInput !== null) {
    myOrdersSearchInput.value = '';
  }
  const myOrdersStatusFilterInput = document.getElementById(ELEMENT_IDS.myOrdersStatusFilter) as HTMLSelectElement | null;
  if (myOrdersStatusFilterInput !== null) {
    myOrdersStatusFilterInput.value = 'all';
  }
  setText(ELEMENT_IDS.myOrdersCount, '');
  setText(ELEMENT_IDS.myOrdersStateMessage, '');
  // Stage 13: the settings belong to the session that just ended too. They are
  // cleared for the same reason as the audit trail above, and each value is
  // emptied individually so no configured limit or time survives behind the login
  // form. The "not configured" banner is reset too, because leaving it visible
  // would claim a state that no longer belongs to anybody.
  loadedAppSettings = null;
  settingsInFlight = false;
  settingsSaveInFlight = false;
  // The editable controls are cleared by resetting their value, not their text.
  const minDaysInput = document.getElementById(ELEMENT_IDS.settingsMinDays) as HTMLInputElement | null;
  if (minDaysInput !== null) {
    minDaysInput.value = '';
  }
  const fridayInput = document.getElementById(ELEMENT_IDS.settingsFriday) as HTMLSelectElement | null;
  if (fridayInput !== null) {
    fridayInput.value = '';
  }
  const startTimeInput = document.getElementById(ELEMENT_IDS.settingsStartTime) as HTMLInputElement | null;
  if (startTimeInput !== null) {
    startTimeInput.value = '';
  }
  const endTimeInput = document.getElementById(ELEMENT_IDS.settingsEndTime) as HTMLInputElement | null;
  if (endTimeInput !== null) {
    endTimeInput.value = '';
  }
  setText(ELEMENT_IDS.settingsMaxDaily, '');
  setText(ELEMENT_IDS.settingsAssistant, '');
  setHidden(ELEMENT_IDS.settingsNotConfigured, true);
  setText(ELEMENT_IDS.settingsStateMessage, '');
  // Stage 14: the movement audit rows belong to the session that just ended, so
  // they are cleared for the same reason as every other page's data. Each control
  // is reset too, so a search term or a direction filter cannot survive sign-out
  // and reappear to the next person who signs in.
  loadedStockMovements = null;
  stockMovementsInFlight = false;
  stockSearchTerm = '';
  stockDirectionFilter = 'all';
  const stockRows = document.getElementById(ELEMENT_IDS.stockRows);
  if (stockRows !== null) {
    stockRows.textContent = '';
  }
  setText(ELEMENT_IDS.stockCount, '');
  setText(ELEMENT_IDS.stockStateMessage, '');
  const rows = document.getElementById(ELEMENT_IDS.usersRows);
  if (rows !== null) {
    rows.textContent = '';
  }
  setText(ELEMENT_IDS.usersCount, '');
  setText(ELEMENT_IDS.usersSearch, '');
  setText(ELEMENT_IDS.userDialogErrorMessage, '');
  setText(ELEMENT_IDS.shellUserName, '');
  setText(ELEMENT_IDS.shellUserEmail, '');
  setText(ELEMENT_IDS.shellUserRole, '');
  setText(ELEMENT_IDS.dashboardUserName, '');
  setText(ELEMENT_IDS.dashboardUserEmail, '');
  setHidden(ELEMENT_IDS.shellView, true);
  setHidden(ELEMENT_IDS.loginView, false);
  setErrorMessage(message);
  applyState('unauthenticated');
}

/** Renders the shell header and dashboard from the safe authentication state. */
function renderIdentity(state: SafeAuthState): void {
  const name = displayNameOf(state);
  const email = state.email ?? '';

  setText(ELEMENT_IDS.shellUserName, name);
  setText(ELEMENT_IDS.shellUserEmail, email);
  setText(ELEMENT_IDS.shellUserRole, roleLabelOf(state.role));
  setText(ELEMENT_IDS.dashboardUserName, name);
  setText(ELEMENT_IDS.dashboardUserEmail, email);
}

/**
 * Switches to the manager shell.
 *
 * The state rendered here is the SAFE one returned by Stage 7: an authenticated
 * flag, a uid, an email, a display name and an advisory role. No token is
 * involved, and nothing in the shell is gated on the role.
 */
function showShell(state: SafeAuthState): void {
  if (currentAuthState !== null && currentAuthState.uid !== state.uid) {
    invalidateOrderHistoryRequests();
    loadedOrderHistory = null;
    ordersHistoryHasMore = false;
    ordersHistoryLoadMoreMessage = '';
    ordersHistoryLoadMoreRetryable = false;
    const rows = document.getElementById(ELEMENT_IDS.ordersHistoryRows);
    if (rows !== null) {
      rows.textContent = '';
    }
    closeOrderHistoryDialog();
  }
  currentAuthState = state;
  setHidden(ELEMENT_IDS.loginView, true);
  setHidden(ELEMENT_IDS.shellView, false);
  setErrorMessage(null);
  renderIdentity(state);
  selectView('dashboard');
  applyState('authenticated');
}

/**
 * Switches the content area to a navigation view.
 *
 * A placeholder view performs NO data operation - there is no API call in this
 * function at all, because there is nothing real to show yet.
 */
function selectView(view: string): void {
  const entry = NAV_ENTRIES.find((candidate) => candidate.view === view);
  const target = entry ?? NAV_ENTRIES[0];
  if (target === undefined) {
    return;
  }

  const buttons = document.querySelectorAll('[data-view]');
  for (const button of buttons) {
    const isActive = button.getAttribute('data-view') === target.view;
    button.classList.toggle('is-active', isActive);
    if (isActive) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  }

  const dashboardHidden = target.view !== 'dashboard';
  const usersHidden = target.view !== 'users';
  const medicinesHidden = target.view !== 'medicines';
  const ordersHidden = target.view !== 'orders';
  const ordersHistoryHidden = target.view !== 'orders-history';
  const myOrdersHidden = target.view !== 'my-orders';
  const settingsHidden = target.view !== 'settings';
  const requestSubmitHidden = target.view !== 'request-submit';
  setHidden(ELEMENT_IDS.dashboardView, dashboardHidden);
  setHidden(ELEMENT_IDS.usersView, usersHidden);
  setHidden(ELEMENT_IDS.medicinesView, medicinesHidden);
  setHidden(ELEMENT_IDS.ordersView, ordersHidden);
  setHidden(ELEMENT_IDS.ordersHistoryView, ordersHistoryHidden);
  setHidden(ELEMENT_IDS.myOrdersView, myOrdersHidden);
  setHidden(ELEMENT_IDS.settingsView, settingsHidden);
  setHidden(ELEMENT_IDS.requestSubmitView, requestSubmitHidden);
  // Stage 14: the movement audit panel. Hidden like every other page unless it is
  // the active view, so its rows can never be read out of context on another one.
  const stockHidden = target.view !== 'stock';
  setHidden(ELEMENT_IDS.stockView, stockHidden);
  setHidden(ELEMENT_IDS.placeholderView, target.implemented);

  if (target.implemented) {
    // Each page loads on first open and then serves from its cache, so
    // switching back to it does not re-hit the backend for no reason.
    if (target.view === 'users') {
      if (loadedUsers === null) {
        void loadUsers('loading');
      } else {
        renderUsers();
      }
    }
    if (target.view === 'medicines') {
      if (loadedMedicines === null) {
        void loadMedicines('loading');
      } else {
        renderMedicines();
      }
    }
    if (target.view === 'orders') {
      if (loadedOrders === null) {
        void loadOrders('loading');
      } else {
        renderOrders();
      }
    }
    // Stage 12: the history page loads once, then serves from its own cache. The
    // cache is separate from the Stage 11 queue's so neither can mask the other.
    if (target.view === 'orders-history') {
      if (loadedOrderHistory === null) {
        void loadOrderHistory('loading');
      } else {
        renderOrderHistory();
      }
    }
    if (target.view === 'my-orders') {
      if (loadedMyOrderHistory === null) {
        void loadMyOrderHistory('loading');
      } else {
        renderMyOrderHistory();
      }
    }
    // Stage 13: the settings page loads once, then serves from its own cache, the
    // same way the other pages do. Reading `settings/app` again on every visit
    // would buy nothing: the document changes only when the mobile settings
    // screen saves it, and the refresh button is there for that moment.
    if (target.view === 'settings') {
      if (loadedAppSettings === null) {
        void loadSettings('loading');
      } else {
        renderSettings();
      }
    }
    // Stage 14: the movement audit page loads once, then serves from its own
    // cache, with a cache separate from the orders history so neither can mask
    // the other. Movements are appended by the Stage 6 processor and by the
    // mobile app, and the refresh button exists for the moment one arrives.
    if (target.view === 'stock') {
      if (loadedStockMovements === null) {
        void loadStockMovements('loading');
      } else {
        renderStockMovements();
      }
    }
    if (target.view === 'request-submit') {
      if (requestMedicines === null) {
        void loadRequestMedicines();
      } else {
        renderRequestItems();
        setRequestSubmitState('ready', '');
      }
    }
    return;
  }

  setText(ELEMENT_IDS.placeholderTitle, target.label);
}
/**
 * Renders the process status block from the Stage 7 `getAppStatus` payload.
 *
 * This is the only non-authentication call the shell makes, and it is a purely
 * local read of the Main process's own metadata: no token, no storage, no
 * network. It is fetched once at start-up regardless of the current view,
 * because the running state of the application is a property of the process and
 * not of the session.
 */
async function renderAppStatus(api: DrugManagerApi): Promise<void> {
  try {
    const payload = await api.getAppStatus();
    setText(ELEMENT_IDS.statusValue, `${payload.heading}: ${payload.label}`);

    const card = document.getElementById(ELEMENT_IDS.statusCard);
    card?.setAttribute('data-state', 'ready');

    const list = document.getElementById(ELEMENT_IDS.infoList);
    if (list === null) {
      return;
    }
    list.textContent = '';
    const rows: readonly (readonly [string, string])[] = [
      ['اسم التطبيق', payload.appName],
      ['إصدار التطبيق', payload.version],
      ['إصدار Electron', payload.electronVersion],
      ['إصدار Node.js', payload.nodeVersion],
      ['اللغة / الاتجاه', `${payload.locale} / ${payload.rtl ? 'RTL' : 'LTR'}`],
      ['بدء التشغيل', payload.startedAtIso],
      ['واجهة الجسر الآمنة', `drugManager API ${api.apiVersion}`],
    ];
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      list.append(term, description);
    }
  } catch (error: unknown) {
    setText(ELEMENT_IDS.statusValue, 'تعذر قراءة معلومات التشغيل');
    document.getElementById(ELEMENT_IDS.statusCard)?.setAttribute('data-state', 'error');
  }
}

/**
 * Reads the safe authentication state and routes to the right view.
 *
 * This is the start-up decision point and the single place where the shell asks
 * "is anybody signed in?". The answer comes from the Main process session; this
 * file cannot conclude otherwise, because it holds no credential.
 */
async function resolveAuthentication(api: DrugManagerApi): Promise<void> {
  let state: SafeAuthState;
  try {
    state = await api.auth.getState();
  } catch (error: unknown) {
    showLogin(STATE_UNAVAILABLE_MESSAGE);
    return;
  }

  if (state.authenticated) {
    showShell(state);
  } else {
    showLogin(null);
  }
}
/**
 * Handles the login form.
 *
 * The payload is exactly `{ email, password }` - the only two fields the Stage 7
 * contract accepts, and nothing is added to it. On success the safe state is
 * RE-READ through `getState()` rather than taken from the sign-in result, so the
 * shell always renders the state the Main process currently considers
 * authoritative.
 */
async function handleLoginSubmit(event: Event): Promise<void> {
  event.preventDefault();

  // A second submit while one is in flight is dropped, not queued. The button is
  // already disabled, but this guard also covers the Enter key and a
  // programmatic submit.
  if (currentState === 'authenticating') {
    return;
  }

  const api = getDrugManagerApi();
  if (api === null) {
    showLogin(BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  const emailField = document.getElementById(ELEMENT_IDS.loginEmail) as HTMLInputElement | null;
  const passwordField = document.getElementById(ELEMENT_IDS.loginPassword) as HTMLInputElement | null;
  const email = emailField?.value ?? '';
  const password = passwordField?.value ?? '';

  if (email.trim().length === 0 || password.length === 0) {
    setErrorMessage('يُرجى إدخال البريد الإلكتروني وكلمة المرور.');
    return;
  }

  setErrorMessage(null);
  applyState('authenticating');

  let result: SignInResult;
  try {
    result = await api.auth.signIn({ email, password });
  } catch (error: unknown) {
    clearPassword();
    showLogin(STATE_UNAVAILABLE_MESSAGE);
    return;
  }

  clearPassword();
  resetPasswordToggle();

  if (!result.success) {
    // Only the SAFE Arabic message from Stage 7 is displayed. The technical code
    // is deliberately not rendered: it exists for logs, not for the user.
    showLogin(result.error?.message ?? STATE_UNAVAILABLE_MESSAGE);
    return;
  }

  let state: SafeAuthState;
  try {
    state = await api.auth.getState();
  } catch (error: unknown) {
    showLogin(STATE_UNAVAILABLE_MESSAGE);
    return;
  }

  if (!state.authenticated) {
    showLogin(STATE_UNAVAILABLE_MESSAGE);
    return;
  }

  showShell(state);
}
/**
 * Signs out and returns to the login form.
 *
 * The token is cleared by the Main process inside `signOut`; this file never tries
 * to clear, read or invalidate anything, because it has nothing to clear. Every
 * piece of renderer state is wiped so no stale identity remains on screen.
 */
async function handleLogout(): Promise<void> {
  if (currentState === 'signing-out') {
    return;
  }

  const api = getDrugManagerApi();
  if (api === null) {
    showLogin(BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  applyState('signing-out');
  invalidateOrderHistoryRequests();

  try {
    await api.auth.signOut();
  } catch (error: unknown) {
    // Even a failed sign-out returns to the login form: staying on a shell whose
    // session may already be gone is the worse of the two outcomes.
  }

  clearPassword();
  resetPasswordToggle();
  showLogin(null);
}

/** Toggles the password field between masked and plain text. */
function handlePasswordToggle(): void {
  const password = document.getElementById(ELEMENT_IDS.loginPassword) as HTMLInputElement | null;
  const toggle = document.getElementById(ELEMENT_IDS.passwordToggle) as HTMLButtonElement | null;
  if (password === null || toggle === null) {
    return;
  }
  const revealed = password.type === 'text';
  password.type = revealed ? 'password' : 'text';
  toggle.textContent = revealed ? 'إظهار' : 'إخفاء';
  toggle.setAttribute('aria-pressed', revealed ? 'false' : 'true');
}

/** Wires the static event handlers. */
/** Renders one cell of the users table. */
function appendCell(row: HTMLTableRowElement, text: string, className?: string): void {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className !== undefined) {
    cell.setAttribute('class', className);
  }
  row.append(cell);
}

/** The "last order" cell: the normalised month plus the summary status. */
function describeLastOrder(user: UserListItemView): string {
  // `lastOrderMonthYearDisplay` is the D1-normalised READ form. It is never
  // written back: there is no update path to that field, so normalising a read
  // stays presentation rather than migration.
  const month = user.lastOrderMonthYearDisplay;
  if (month === null) {
    return 'لا يوجد طلب سابق';
  }
  return `${month} — ${labelOf(LAST_ORDER_STATUS_LABELS, user.lastOrderStatus)}`;
}

/**
 * Renders the users table and the count.
 *
 * Called after every load, every search keystroke and every save, so there is one
 * place that decides what the page looks like and no way for two of those to
 * disagree about it.
 */
function renderUsers(): void {
  const rows = document.getElementById(ELEMENT_IDS.usersRows);
  if (rows === null) {
    return;
  }
  const users = visibleUsers();
  rows.textContent = '';

  for (const user of users) {
    const row = document.createElement('tr');
    row.setAttribute('data-uid', user.uid);
    appendCell(row, user.name, 'cell-name');
    appendCell(row, user.employeeId, 'cell-id');
    appendCell(row, roleLabelOf(user.role), 'cell-role');
    appendCell(row, labelOf(USER_STATUS_LABELS, user.status), 'cell-status');
    appendCell(row, describeLastOrder(user), 'cell-last-order');

    const actions = document.createElement('td');
    const open = document.createElement('button');
    open.setAttribute('type', 'button');
    open.setAttribute('class', 'button button-ghost button-small');
    open.setAttribute('data-uid', user.uid);
    open.setAttribute('aria-label', `عرض تفاصيل ${user.name}`);
    open.textContent = 'تفاصيل';
    open.addEventListener('click', () => {
      openUserDialog(user.uid);
    });
    actions.append(open);
    row.append(actions);

    rows.append(row);
  }

  const total = loadedUsers === null ? 0 : loadedUsers.length;
  setText(
    ELEMENT_IDS.usersCount,
    searchTerm.trim().length === 0
      ? `عدد المستخدمين: ${total}`
      : `عدد النتائج: ${users.length} من ${total}`,
  );
}

/**
 * Sets the users page state.
 *
 * `loading`, `refreshing` and `saving` all keep the previous rows on screen
 * instead of blanking the page, so the manager does not lose their place in the
 * list every time they act.
 */
function setUsersState(state: UsersViewState, message: string): void {
  const region = document.getElementById(ELEMENT_IDS.usersState);
  region?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.usersStateMessage, message);
  setHidden(ELEMENT_IDS.usersRetry, state !== 'error');
  setDisabled(ELEMENT_IDS.usersRefresh, state === 'loading' || state === 'refreshing' || state === 'saving');
}
function attachHandlers(): void {
  document.getElementById(ELEMENT_IDS.loginForm)?.addEventListener('submit', (event: Event) => {
    void handleLoginSubmit(event);
  });

  document.getElementById(ELEMENT_IDS.passwordToggle)?.addEventListener('click', () => {
    handlePasswordToggle();
  });

  document.getElementById(ELEMENT_IDS.logoutButton)?.addEventListener('click', () => {
    void handleLogout();
  });

  // ---- Stage 9: the users module ----
  document.getElementById(ELEMENT_IDS.usersRefresh)?.addEventListener('click', () => {
    void loadUsers('refreshing');
  });
  document.getElementById(ELEMENT_IDS.usersRetry)?.addEventListener('click', () => {
    void loadUsers('refreshing');
  });
  // The search input filters what is ALREADY loaded. No request leaves here.
  document.getElementById(ELEMENT_IDS.usersSearch)?.addEventListener('input', (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    applySearch(input?.value ?? '');
  });
  document.getElementById(ELEMENT_IDS.userDialogClose)?.addEventListener('click', () => {
    closeUserDialog();
  });
  document.getElementById(ELEMENT_IDS.userSave)?.addEventListener('click', () => {
    const field = document.getElementById(ELEMENT_IDS.userDetailName) as HTMLInputElement | null;
    void submitUserUpdate({ name: field?.value ?? '' });
  });
  document.getElementById(ELEMENT_IDS.userApprove)?.addEventListener('click', () => {
    void submitUserUpdate({ approval: 'approve' });
  });
  document.getElementById(ELEMENT_IDS.userReject)?.addEventListener('click', () => {
    void submitUserUpdate({ approval: 'reject' });
  });
  document.getElementById(ELEMENT_IDS.userGrantException)?.addEventListener('click', () => {
    void submitUserUpdate({ exception: 'grant' });
  });
  document.getElementById(ELEMENT_IDS.userRevokeException)?.addEventListener('click', () => {
    void submitUserUpdate({ exception: 'revoke' });
  });

  // ---- Stage 10: the medicines module ----
  document.getElementById(ELEMENT_IDS.medicinesRefresh)?.addEventListener('click', () => {
    void loadMedicines('refreshing');
  });
  document.getElementById(ELEMENT_IDS.medicinesRetry)?.addEventListener('click', () => {
    void loadMedicines('refreshing');
  });
  // The catalogue filter works on what is ALREADY loaded. No request leaves here.
  document.getElementById(ELEMENT_IDS.medicinesSearch)?.addEventListener('input', (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    applyMedicineSearch(input?.value ?? '');
  });
  document.getElementById(ELEMENT_IDS.medicineDialogClose)?.addEventListener('click', () => {
    closeMedicineDialog();
  });

  // ---- Stage 11: the order-requests module ----
  document.getElementById(ELEMENT_IDS.ordersRefresh)?.addEventListener('click', () => {
    void loadOrders('refreshing');
  });
  document.getElementById(ELEMENT_IDS.ordersRetry)?.addEventListener('click', () => {
    void loadOrders('refreshing');
  });
  // The search box filters what is ALREADY loaded. No request leaves here.
  document.getElementById(ELEMENT_IDS.ordersSearch)?.addEventListener('input', (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    applyOrderSearch(input?.value ?? '');
  });
  document.getElementById(ELEMENT_IDS.ordersStatusFilter)?.addEventListener('change', (event: Event) => {
    const input = event.target as HTMLSelectElement | null;
    applyOrderStatusFilter(input?.value ?? 'all');
  });
  document.getElementById(ELEMENT_IDS.orderDialogClose)?.addEventListener('click', () => {
    closeOrderDialog();
  });
  document.getElementById(ELEMENT_IDS.orderDialogRefresh)?.addEventListener('click', () => {
    void reloadSelectedOrder();
  });
  // The action OPENS a confirmation; it does not process on its own.
  document.getElementById(ELEMENT_IDS.orderProcess)?.addEventListener('click', () => {
    const target = selectedOrder;
    if (target !== null) {
      confirmOrderProcessing(target.id);
    }
  });
  document.getElementById(ELEMENT_IDS.orderConfirmCancel)?.addEventListener('click', () => {
    closeOrderConfirmDialog();
  });
  document.getElementById(ELEMENT_IDS.orderConfirmAccept)?.addEventListener('click', () => {
    void submitOrderProcessing();
  });

  // ---- Stage 12: the orders-history module (READ-ONLY) ----
  //
  // Every handler here either re-reads the list or changes what is already on
  // screen. There is deliberately NO submit, save, process or delete listener in
  // this block: the page owns no write, so there is nothing here to intercept.
  document.getElementById(ELEMENT_IDS.ordersHistoryRefresh)?.addEventListener('click', () => {
    void loadOrderHistory('refreshing');
  });
  document.getElementById(ELEMENT_IDS.ordersHistoryRetry)?.addEventListener('click', () => {
    void loadOrderHistory('refreshing');
  });
  document.getElementById(ELEMENT_IDS.ordersHistoryPrint)?.addEventListener('click', () => {
    printOrderHistoryReport();
  });
  document.getElementById(ELEMENT_IDS.ordersHistoryLoadMore)?.addEventListener('click', () => {
    void loadMoreOrderHistory();
  });
  // The search box filters what is ALREADY loaded. No request leaves here.
  document.getElementById(ELEMENT_IDS.ordersHistorySearchInput)?.addEventListener('input', (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    ordersHistorySearchTerm = input?.value ?? '';
    renderOrderHistory();
    if (!ordersHistoryInFlight && !ordersHistoryLoadMoreInFlight) {
      setOrderHistoryDataState();
    }
  });
  document.getElementById(ELEMENT_IDS.ordersHistoryStatusFilter)?.addEventListener('change', (event: Event) => {
    const input = event.target as HTMLSelectElement | null;
    applyOrderHistoryStatusFilter(input?.value ?? 'all');
  });
  document.getElementById(ELEMENT_IDS.orderHistoryDialogClose)?.addEventListener('click', () => {
    closeOrderHistoryDialog();
  });
  // Stage 17: both controls only repeat the same owner-scoped read.
  document.getElementById(ELEMENT_IDS.myOrdersRefresh)?.addEventListener('click', () => {
    void loadMyOrderHistory('refreshing');
  });
  document.getElementById(ELEMENT_IDS.myOrdersRetry)?.addEventListener('click', () => {
    void loadMyOrderHistory('refreshing');
  });
  document.getElementById(ELEMENT_IDS.myOrdersPrint)?.addEventListener('click', () => {
    printMyOrderHistoryReport();
  });
  document.getElementById(ELEMENT_IDS.myOrdersSearchInput)?.addEventListener('input', (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    myOrdersSearchTerm = input?.value ?? '';
    renderMyOrderHistory();
  });
  document.getElementById(ELEMENT_IDS.myOrdersStatusFilter)?.addEventListener('change', (event: Event) => {
    const input = event.target as HTMLSelectElement | null;
    myOrdersStatusFilter = ORDER_HISTORY_FILTER_VALUES.has(input?.value ?? 'all') ? input?.value ?? 'all' : 'all';
    renderMyOrderHistory();
  });
  document.getElementById(ELEMENT_IDS.myOrdersClearFilters)?.addEventListener('click', () => {
    myOrdersSearchTerm = '';
    myOrdersStatusFilter = 'all';
    const searchInput = document.getElementById(ELEMENT_IDS.myOrdersSearchInput) as HTMLInputElement | null;
    if (searchInput !== null) {
      searchInput.value = '';
    }
    const statusSelect = document.getElementById(ELEMENT_IDS.myOrdersStatusFilter) as HTMLSelectElement | null;
    if (statusSelect !== null) {
      statusSelect.value = 'all';
    }
    renderMyOrderHistory();
  });
  // Stage 18: re-read only the request id returned by the successful submission.
  document.getElementById(ELEMENT_IDS.requestStatusRefresh)?.addEventListener('click', () => {
    void refreshSubmittedRequestStatus();
  });
  document.getElementById(ELEMENT_IDS.medicineSave)?.addEventListener('click', () => {
    void submitMedicineUpdate();
  });
  // Stage 15: the inbound receipt action, inside the SAME dialog. One click, one
  // named operation, one transaction - and no second call to forget.
  document.getElementById(ELEMENT_IDS.medicineAddInbound)?.addEventListener('click', () => {
    void submitInboundStock();
  });

  document.getElementById(ELEMENT_IDS.settingsRefresh)?.addEventListener('click', () => {
    void loadSettings('refreshing');
  });
  document.getElementById(ELEMENT_IDS.settingsRetry)?.addEventListener('click', () => {
    void loadSettings('loading');
  });
  document.getElementById(ELEMENT_IDS.settingsSave)?.addEventListener('click', () => {
    void submitSettingsSave();
  });

  // Stage 14: the movement audit page. Refresh and retry are the ONLY actions, and
  // both merely re-read. The page owns no write, so there is nothing to intercept.
  document.getElementById(ELEMENT_IDS.stockRefresh)?.addEventListener('click', () => {
    void loadStockMovements('refreshing');
  });
  document.getElementById(ELEMENT_IDS.stockRetry)?.addEventListener('click', () => {
    void loadStockMovements('loading');
  });
  // Both controls below filter what is ALREADY loaded. No request leaves here, so
  // typing in the search box cannot become a query the transport cannot express.
  document.getElementById(ELEMENT_IDS.stockSearch)?.addEventListener('input', (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    stockSearchTerm = input?.value ?? '';
    renderStockMovements();
  });
  document.getElementById(ELEMENT_IDS.stockDirectionFilter)?.addEventListener('change', (event: Event) => {
    const input = event.target as HTMLSelectElement | null;
    applyStockDirectionFilter(input?.value ?? 'all');
  });
  // Stage 16: compose request lines locally, then send only their ids and
  // quantities through the one named submission operation.
  document.getElementById(ELEMENT_IDS.requestAddItem)?.addEventListener('click', () => {
    addRequestItem();
  });
  document.getElementById(ELEMENT_IDS.requestSubmit)?.addEventListener('click', () => {
    void submitOrderRequest();
  });
  document.getElementById(ELEMENT_IDS.requestSubmitRetry)?.addEventListener('click', () => {
    requestMedicines = null;
    void loadRequestMedicines();
  });
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => {
      const view = button.getAttribute('data-view');
      if (view !== null) {
        selectView(view);
      }
    });
  }
}

/**
 * Start-up.
 *
 * Order matters: the status block is fetched first because it describes the
 * process rather than the session, and the shell must render it whether or not
 * anybody is signed in.
 */
async function bootstrap(): Promise<void> {
  applyState('initializing');

  const api = getDrugManagerApi();
  if (api === null) {
    showLogin(BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  attachHandlers();
  await renderAppStatus(api);
  await resolveAuthentication(api);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
} else {
  void bootstrap();
}
/**
 * Loads the users list through the named Stage 7 operation.
 *
 * `loading` is the first open (no rows yet); `refreshing` is an explicit reload
 * (rows stay visible). A second call while one is in flight is dropped rather
 * than queued, so a double-click cannot produce two requests.
 */
async function loadUsers(reason: 'loading' | 'refreshing'): Promise<void> {
  if (usersRequestInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setUsersState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  usersRequestInFlight = true;
  setUsersState(reason, reason === 'loading' ? 'جارٍ تحميل المستخدمين…' : 'جارٍ التحديث…');

  let result: ApplicationResult<readonly UserListItemView[]>;
  try {
    result = await api.users.list();
  } catch (error: unknown) {
    usersRequestInFlight = false;
    setUsersState('error', 'تعذر تحميل المستخدمين. يُرجى المحاولة مرة أخرى.');
    return;
  }
  usersRequestInFlight = false;

  if (!result.ok) {
    // Only the safe Arabic sentence Stage 7 produced is shown; the code is never
    // rendered.
    setUsersState('error', result.error.message);
    return;
  }

  loadedUsers = result.value;
  if (loadedUsers.length === 0) {
    setUsersState('empty', 'لا يوجد مستخدمون.');
  } else if (searchTerm.trim().length > 0 && visibleUsers().length === 0) {
    setUsersState('empty', 'لا توجد نتائج مطابقة للبحث.');
  } else {
    setUsersState('ready', '');
  }
  renderUsers();
}

/** Applies the current search term locally. No request is sent. */
function applySearch(term: string): void {
  searchTerm = term;
  renderUsers();
  const visible = visibleUsers();
  if (loadedUsers !== null && loadedUsers.length > 0) {
    setUsersState(
      visible.length === 0 ? 'empty' : 'ready',
      visible.length === 0 ? 'لا توجد نتائج مطابقة للبحث.' : '',
    );
  }
}
/** Fills the dialog from a loaded user. */
function openUserDialog(uid: string): void {
  const user = (loadedUsers ?? []).find((candidate) => candidate.uid === uid);
  if (user === undefined) {
    return;
  }
  selectedUser = user;

  setUserDialogError(null);
  setText(ELEMENT_IDS.userDetailRole, roleLabelOf(user.role));
  setText(ELEMENT_IDS.userDetailEmployeeId, user.employeeId);
  setText(ELEMENT_IDS.userDetailStatus, labelOf(USER_STATUS_LABELS, user.status));
  setText(ELEMENT_IDS.userDetailLastOrder, describeLastOrder(user));
  setText(ELEMENT_IDS.userDetailException, user.hasException ? 'نعم' : 'لا');

  const nameField = document.getElementById(ELEMENT_IDS.userDetailName) as HTMLInputElement | null;
  if (nameField !== null) {
    nameField.value = user.name;
  }

  applyEditAvailability(user);
  showUserDialog();
}

/**
 * Enables the edit controls.
 *
 * This is USABILITY ONLY, and it is worth being precise about why it is not a
 * security decision: an employee who reaches these buttons anyway is refused by
 * firestore.rules, not by this flag. Hiding them saves a pointless round trip and
 * a confusing error; it grants nothing. The Stage 9 emulator suite proves the
 * server still answers 403.
 */
function applyEditAvailability(user: UserListItemView): void {
  const isManager = user.role === 'admin' || user.role === 'assistant';
  const busy = userSaveInFlight;
  setDisabled(ELEMENT_IDS.userSave, !isManager || busy);
  setDisabled(ELEMENT_IDS.userApprove, !isManager || user.status === 'approved' || busy);
  setDisabled(ELEMENT_IDS.userReject, !isManager || user.status === 'rejected' || busy);
  setDisabled(ELEMENT_IDS.userGrantException, !isManager || user.hasException || busy);
  setDisabled(ELEMENT_IDS.userRevokeException, !isManager || !user.hasException || busy);
}

/** Shows the dialog, tolerating a harness without the `showModal` method. */
function showUserDialog(): void {
  const dialog = document.getElementById(ELEMENT_IDS.userDialog) as (HTMLElement & { showModal?: () => void }) | null;
  if (dialog !== null && typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }
  setHidden(ELEMENT_IDS.userDialog, false);
}

/** Closes the dialog and drops the selection. */
function closeUserDialog(): void {
  selectedUser = null;
  userSaveInFlight = false;
  const dialog = document.getElementById(ELEMENT_IDS.userDialog) as (HTMLElement & { close?: () => void }) | null;
  if (dialog !== null && typeof dialog.close === 'function') {
    dialog.close();
    return;
  }
  setHidden(ELEMENT_IDS.userDialog, true);
}

/** Shows or clears the dialog's safe error region. */
function setUserDialogError(message: string | null): void {
  setText(ELEMENT_IDS.userDialogErrorMessage, message ?? '');
  setHidden(ELEMENT_IDS.userDialogError, message === null);
}

/**
 * Sends ONE permitted transition and then re-reads the list.
 *
 * The list is re-read rather than patched locally on purpose: the write is
 * masked, so the server deliberately left the `lastOrder*` summary alone, and
 * only a fresh read can prove what is actually stored.
 */
async function submitUserUpdate(change: Omit<UpdateUserInput, 'uid'>): Promise<void> {
  if (userSaveInFlight || selectedUser === null) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setUserDialogError(BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  const target = selectedUser;
  userSaveInFlight = true;
  setUsersState('saving', 'جارٍ الحفظ…');
  setUserDialogError(null);
  applyEditAvailability(target);

  let result: ApplicationResult<null>;
  try {
    result = await api.users.update({ uid: target.uid, ...change });
  } catch (error: unknown) {
    // The dialog keeps its contents, so a transient failure does not discard
    // what the manager typed.
    userSaveInFlight = false;
    setUserDialogError('تعذر تنفيذ العملية. يُرجى المحاولة مرة أخرى.');
    setUsersState('ready', '');
    applyEditAvailability(target);
    return;
  }
  userSaveInFlight = false;

  if (!result.ok) {
    setUserDialogError(result.error.message);
    setUsersState('ready', '');
    applyEditAvailability(target);
    return;
  }

  closeUserDialog();
  await loadUsers('refreshing');
}

/* ===========================================================================
   MEDICINES (Stage 10)

   The page reads the whole catalogue and filters it locally, and it edits
   exactly one field. Both decisions follow from what the architecture supports:
   the REST layer cannot query this collection by name (Stage 3 has no `where`
   here), and the repository exposes a single write.
   =========================================================================== */

/** Renders one catalogue cell. */
function appendMedicineCell(row: HTMLTableRowElement, text: string, className?: string): void {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className !== undefined) {
    cell.setAttribute('class', className);
  }
  row.append(cell);
}

/** Renders the catalogue table and the count. */
function renderMedicines(): void {
  const rows = document.getElementById(ELEMENT_IDS.medicinesRows);
  if (rows === null) {
    return;
  }
  const medicines = visibleMedicines();
  rows.textContent = '';

  for (const medicine of medicines) {
    const row = document.createElement('tr');
    row.setAttribute('data-medicine-id', medicine.id);

    // The four numbers are printed EXACTLY as stored. Nothing here subtracts,
    // sums or derives an inventory figure.
    appendMedicineCell(row, medicine.name, 'cell-name');
    appendMedicineCell(row, String(medicine.stock), 'cell-number');
    appendMedicineCell(row, String(medicine.maxQuantity), 'cell-number');
    appendMedicineCell(row, String(medicine.totalInward), 'cell-number');
    appendMedicineCell(row, String(medicine.totalOutward), 'cell-number');

    const actions = document.createElement('td');
    const open = document.createElement('button');
    open.setAttribute('type', 'button');
    open.setAttribute('class', 'button button-ghost button-small');
    open.setAttribute('data-medicine-id', medicine.id);
    open.setAttribute('aria-label', `عرض تفاصيل ${medicine.name}`);
    open.textContent = 'تفاصيل';
    open.addEventListener('click', () => {
      openMedicineDialog(medicine.id);
    });
    actions.append(open);
    row.append(actions);

    rows.append(row);
  }

  const total = loadedMedicines === null ? 0 : loadedMedicines.length;
  setText(
    ELEMENT_IDS.medicinesCount,
    medicineSearchTerm.trim().length === 0
      ? `عدد الأدوية: ${total}`
      : `عدد النتائج: ${medicines.length} من ${total}`,
  );
}

/** Sets the catalogue page state, keeping rows visible while busy. */
function setMedicinesState(state: UsersViewState, message: string): void {
  const region = document.getElementById(ELEMENT_IDS.medicinesState);
  region?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.medicinesStateMessage, message);
  setHidden(ELEMENT_IDS.medicinesRetry, state !== 'error');
  const busy = state === 'loading' || state === 'refreshing' || state === 'saving';
  setDisabled(ELEMENT_IDS.medicinesRefresh, busy);
  setDisabled(ELEMENT_IDS.medicineSave, busy);
}
/** Loads the catalogue through the named Stage 7 operation. */
async function loadMedicines(reason: 'loading' | 'refreshing'): Promise<void> {
  if (medicinesRequestInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setMedicinesState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  medicinesRequestInFlight = true;
  setMedicinesState(reason, reason === 'loading' ? 'جارٍ تحميل الأدوية…' : 'جارٍ التحديث…');

  let result: ApplicationResult<readonly MedicineListItemView[]>;
  try {
    result = await api.medicines.list();
  } catch (error: unknown) {
    medicinesRequestInFlight = false;
    setMedicinesState('error', 'تعذر تحميل الأدوية. يُرجى المحاولة مرة أخرى.');
    return;
  }
  medicinesRequestInFlight = false;

  if (!result.ok) {
    setMedicinesState('error', result.error.message);
    return;
  }

  loadedMedicines = result.value;
  if (loadedMedicines.length === 0) {
    setMedicinesState('empty', 'لا توجد أدوية مسجلة.');
  } else if (medicineSearchTerm.trim().length > 0 && visibleMedicines().length === 0) {
    setMedicinesState('empty', 'لا توجد نتائج مطابقة للبحث.');
  } else {
    setMedicinesState('ready', '');
  }
  renderMedicines();
}

/** Applies the catalogue search term locally. No request is sent. */
function applyMedicineSearch(term: string): void {
  medicineSearchTerm = term;
  renderMedicines();
  const visible = visibleMedicines();
  if (loadedMedicines !== null && loadedMedicines.length > 0) {
    setMedicinesState(
      visible.length === 0 ? 'empty' : 'ready',
      visible.length === 0 ? 'لا توجد نتائج مطابقة للبحث.' : '',
    );
  }
}

/** Shows the medicine dialog, tolerating a harness without `showModal`. */
function showMedicineDialog(): void {
  const dialog = document.getElementById(ELEMENT_IDS.medicineDialog) as (HTMLElement & { showModal?: () => void }) | null;
  if (dialog !== null && typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }
  setHidden(ELEMENT_IDS.medicineDialog, false);
}

/** Closes the medicine dialog and drops the selection. */
function closeMedicineDialog(): void {
  selectedMedicine = null;
  medicineSaveInFlight = false;
  const dialog = document.getElementById(ELEMENT_IDS.medicineDialog) as (HTMLElement & { close?: () => void }) | null;
  if (dialog !== null && typeof dialog.close === 'function') {
    dialog.close();
    return;
  }
  setHidden(ELEMENT_IDS.medicineDialog, true);
}

/** Shows or clears the dialog's safe error region. */
function setMedicineDialogError(message: string | null): void {
  setText(ELEMENT_IDS.medicineDialogErrorMessage, message ?? '');
  setHidden(ELEMENT_IDS.medicineDialogError, message === null);
}

/** Fills the medicine dialog from a loaded catalogue entry. */
function openMedicineDialog(medicineId: string): void {
  const medicine = (loadedMedicines ?? []).find((candidate) => candidate.id === medicineId);
  if (medicine === undefined) {
    return;
  }
  selectedMedicine = medicine;

  setMedicineDialogError(null);
  setText(ELEMENT_IDS.medicineDetailName, medicine.name);
  setText(ELEMENT_IDS.medicineDetailStock, String(medicine.stock));
  setText(ELEMENT_IDS.medicineDetailInward, String(medicine.totalInward));
  setText(ELEMENT_IDS.medicineDetailOutward, String(medicine.totalOutward));

  const field = document.getElementById(ELEMENT_IDS.medicineDetailMaxQuantity) as HTMLInputElement | null;
  if (field !== null) {
    field.value = String(medicine.maxQuantity);
  }
  // Stage 15: the receipt field starts EMPTY every time.
  //
  // Pre-filling it with a number would be the worst possible default on a control
  // whose whole effect is to move inventory: a manager who opens the dialog and
  // clicks the button without reading would commit a receipt of whatever happened
  // to be in the box. An empty field means a receipt can only happen deliberately.
  setText(ELEMENT_IDS.medicineDetailInboundQuantity, '');
  setDisabled(ELEMENT_IDS.medicineSave, false);
  setDisabled(ELEMENT_IDS.medicineAddInbound, false);
  showMedicineDialog();
}
/**
 * Saves the ONE writable field, then re-reads the catalogue.
 *
 * The payload carries a medicine id and a whole number, and nothing else. There
 * is no parameter through which the renderer could send a stock figure, a
 * counter, a document or a mask - which is why the dialog has exactly one input.
 */
async function submitMedicineUpdate(): Promise<void> {
  if (medicineSaveInFlight || selectedMedicine === null) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setMedicineDialogError(BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  const target = selectedMedicine;
  const field = document.getElementById(ELEMENT_IDS.medicineDetailMaxQuantity) as HTMLInputElement | null;
  const parsed = Number.parseInt(field?.value ?? '', 10);
  if (!Number.isInteger(parsed)) {
    setMedicineDialogError('يُرجى إدخال رقماً صحيحاً للحد الأقصى.');
    return;
  }

  medicineSaveInFlight = true;
  setMedicinesState('saving', 'جارٍ الحفظ…');
  setMedicineDialogError(null);
  setDisabled(ELEMENT_IDS.medicineSave, true);

  let result: ApplicationResult<null>;
  try {
    result = await api.medicines.updateMaxQuantity({ medicineId: target.id, maxQuantity: parsed });
  } catch (error: unknown) {
    // The dialog keeps its contents, so a transient failure does not discard
    // what the manager typed.
    medicineSaveInFlight = false;
    setMedicineDialogError('تعذر تنفيذ العملية. يُرجى المحاولة مرة أخرى.');
    setMedicinesState('ready', '');
    setDisabled(ELEMENT_IDS.medicineSave, false);
    return;
  }
  medicineSaveInFlight = false;

  if (!result.ok) {
    setMedicineDialogError(result.error.message);
    setMedicinesState('ready', '');
    setDisabled(ELEMENT_IDS.medicineSave, false);
    return;
  }

  closeMedicineDialog();
  // The list is re-read rather than patched locally: only a fresh read proves
  // what the server stored, and the masked write left every other field alone.
  await loadMedicines('refreshing');
}

/**
 * Stage 15 - records an INBOUND receipt through the single named operation.
 *
 * WHAT THIS FUNCTION SENDS: a medicine id and a positive integer. Nothing else.
 * There is no parameter through which the renderer could send a balance, a counter,
 * a direction, an actor or a document - which is exactly why this dialog offers one
 * numeric field and no other control.
 *
 * WHY IT RE-READS RATHER THAN PATCHING
 *
 * The receipt reports absolute post-write values, but the list is re-read anyway,
 * for the same reason `submitMedicineUpdate` re-reads: only a fresh read proves
 * what the server stored. A locally incremented `stock` would be a number this
 * renderer invented, and on an inventory screen an invented number is the one
 * thing that must never appear.
 *
 * THE AUDIT ROW IS NOT THIS FUNCTION'S BUSINESS
 *
 * It is written inside the same transaction in Main. There is deliberately no
 * second call here, and no way to ask for a receipt without its log - so this
 * module cannot file a movement that no one can explain.
 */
async function submitInboundStock(): Promise<void> {
  if (medicineInboundInFlight || selectedMedicine === null) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setMedicineDialogError(BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  const target = selectedMedicine;
  const field = document.getElementById(ELEMENT_IDS.medicineDetailInboundQuantity) as HTMLInputElement | null;
  const raw = (field?.value ?? '').trim();

  // Checked here as well as in Main, so an empty or nonsense box produces an
  // ordinary Arabic sentence instead of a round trip. Main still validates: this
  // check is for the person typing, not for the boundary.
  if (raw.length === 0) {
    setMedicineDialogError('يُرجى إدخال كمية الوارد.');
    return;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    setMedicineDialogError('كمية الوارد يجب أن تكون رقماً صحيحاً أكبر من صفر.');
    return;
  }

  medicineInboundInFlight = true;
  setMedicinesState('saving', 'جارٍ تسجيل الوارد…');
  setMedicineDialogError(null);
  setDisabled(ELEMENT_IDS.medicineAddInbound, true);
  setDisabled(ELEMENT_IDS.medicineSave, true);

  let result: ApplicationResult<InboundStockReceiptView>;
  try {
    result = await api.medicines.addInboundStock({ medicineId: target.id, quantity: parsed });
  } catch (error: unknown) {
    // The dialog keeps its contents, so a transient failure does not discard what
    // the manager typed and force them to retype a receipt.
    medicineInboundInFlight = false;
    setMedicineDialogError('تعذر تسجيل الوارد. يُرجى المحاولة مرة أخرى.');
    setMedicinesState('ready', '');
    setDisabled(ELEMENT_IDS.medicineAddInbound, false);
    setDisabled(ELEMENT_IDS.medicineSave, false);
    return;
  }
  medicineInboundInFlight = false;
  setDisabled(ELEMENT_IDS.medicineAddInbound, false);
  setDisabled(ELEMENT_IDS.medicineSave, false);

  if (!result.ok) {
    // The safe Arabic sentence, and nothing else: no document path, no raw
    // Firestore message, no stack. The typed quantity stays in the box.
    setMedicineDialogError(result.error.message);
    setMedicinesState('ready', '');
    return;
  }

  closeMedicineDialog();
  await loadMedicines('refreshing');
}

/* ===========================================================================
   ORDER REQUESTS (Stage 11)

   The reminder that governs every function below: this module renders. It does
   not process. Stage 6 owns the transaction, and the only thing this file can
   do that changes anything is forward a request id to `api.orders.process`.
   =========================================================================== */

/** The Arabic label for a stored status; an unknown value never crashes a row. */
function orderRequestStatusLabel(status: string): string {
  return ORDER_REQUEST_STATUS_LABELS[status] ?? UNKNOWN_LABEL;
}

/**
 * The employee as the manager should see them.
 *
 * `employeeName` is resolved by the Main process from `users/{uid}` and may be
 * `null` (the request document stores no name, and reading profiles is
 * admin-only). The uid is then the exact identity the domain does carry, so it
 * is shown rather than a blank cell.
 */
function orderEmployeeLabel(request: OrderRequestListItemView): string {
  const name = request.employeeName;
  return typeof name === 'string' && name.trim().length > 0 ? name : request.uid;
}

/** Renders one ISO timestamp, or a dash when the field is genuinely absent. */
function orderDateLabel(iso: string | null): string {
  return typeof iso === 'string' && iso.length > 0 ? iso : '—';
}

/**
 * The rows currently visible, after the status filter and the search term.
 *
 * Filtering is LOCAL on purpose. The queue is already fully loaded, so a
 * keystroke needs no query; sending one would add round trips and would be
 * refused by firestore.rules for anyone but an admin anyway.
 */
function visibleOrders(): readonly OrderRequestListItemView[] {
  const all = loadedOrders ?? [];
  const filtered = ordersStatusFilter === 'all'
    ? all
    : all.filter((request) => request.status === ordersStatusFilter);
  const needle = normalizeForSearch(ordersSearchTerm);
  if (needle.length === 0) {
    return filtered;
  }
  // Matches the employee (name AND uid, since either may be all the manager has)
  // and any medicine named on the request. Nothing stored is ever rewritten.
  return filtered.filter((request) => {
    if (normalizeForSearch(orderEmployeeLabel(request)).includes(needle)) {
      return true;
    }
    if (normalizeForSearch(request.uid).includes(needle)) {
      return true;
    }
    return request.items.some((item) => normalizeForSearch(item.medicineName).includes(needle));
  });
}

/** Renders one queue cell. */
function appendOrderCell(row: HTMLTableRowElement, text: string, className?: string): void {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className !== undefined) {
    cell.setAttribute('class', className);
  }
  row.append(cell);
}
/** Renders the whole queue from the loaded data. */
function renderOrders(): void {
  const rows = document.getElementById(ELEMENT_IDS.ordersRows);
  if (rows === null) {
    return;
  }
  rows.textContent = '';

  for (const request of visibleOrders()) {
    const row = document.createElement('tr');
    row.setAttribute('data-request-id', request.id);
    appendOrderCell(row, orderEmployeeLabel(request));
    appendOrderCell(row, orderDateLabel(request.requestDateIso));
    appendOrderCell(row, orderRequestStatusLabel(request.status));
    // A COUNT OF REQUESTED LINES, never a sum of quantities: aggregating is
    // Stage 6's job, and a total here would be a second, disagreeing algorithm.
    appendOrderCell(row, String(request.items.length));
    appendOrderCell(row, request.orderId ?? '—');
    appendOrderCell(row, orderDateLabel(request.processedAtIso));

    const actions = document.createElement('td');
    const open = document.createElement('button');
    open.setAttribute('type', 'button');
    open.setAttribute('class', 'button button-ghost');
    open.setAttribute('data-request-id', request.id);
    open.textContent = 'عرض';
    open.addEventListener('click', () => {
      openOrderDialog(request.id);
    });
    actions.append(open);
    row.append(actions);

    rows.append(row);
  }

  const total = loadedOrders === null ? 0 : loadedOrders.length;
  const shown = visibleOrders();
  setText(
    ELEMENT_IDS.ordersCount,
    ordersSearchTerm.trim().length === 0 && ordersStatusFilter === 'all'
      ? `عدد الطلبات: ${total}`
      : `عدد النتائج: ${shown.length} من ${total}`,
  );
}

/** Sets the queue page state, keeping rows visible while busy. */
function setOrdersState(state: UsersViewState, message: string): void {
  const region = document.getElementById(ELEMENT_IDS.ordersState);
  region?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.ordersStateMessage, message);
  setHidden(ELEMENT_IDS.ordersRetry, state !== 'error');
  const busy = state === 'loading' || state === 'refreshing' || state === 'saving';
  setDisabled(ELEMENT_IDS.ordersRefresh, busy);
  setDisabled(ELEMENT_IDS.orderProcess, busy);
}

/** Loads the queue through the named Stage 7 operation. */
function setRequestSubmitState(state: 'idle' | 'loading' | 'ready' | 'validation' | 'submitting' | 'error' | 'success', message: string): void {
  const region = document.getElementById(ELEMENT_IDS.requestSubmitState);
  region?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.requestSubmitStateMessage, message);
  setHidden(ELEMENT_IDS.requestSubmitRetry, !requestMedicinesFailed);
  const busy = state === 'loading' || state === 'submitting' || requestStatusInFlight;
  setDisabled(ELEMENT_IDS.requestMedicineSelect, busy);
  setDisabled(ELEMENT_IDS.requestQuantity, busy);
  setDisabled(ELEMENT_IDS.requestAddItem, busy || requestItems.length >= 5);
  setDisabled(ELEMENT_IDS.requestSubmit, busy || requestItems.length === 0);
}

function setSubmittedRequestStatusState(state: 'idle' | 'loading' | 'ready' | 'error', message: string): void {
  const panel = document.getElementById(ELEMENT_IDS.requestStatusPanel);
  panel?.setAttribute('data-view-state', state);
  setHidden(ELEMENT_IDS.requestStatusPanel, submittedRequestId === null);
  setText(ELEMENT_IDS.requestStatusRequestId, submittedRequestId === null ? '' : `رقم الطلب: ${submittedRequestId}`);
  setText(ELEMENT_IDS.requestStatusMessage, message);
  setDisabled(
    ELEMENT_IDS.requestStatusRefresh,
    submittedRequestId === null || requestSubmissionInFlight || requestStatusInFlight || state === 'loading',
  );
  const busy = requestSubmissionInFlight || requestStatusInFlight;
  setDisabled(ELEMENT_IDS.requestSubmit, busy || requestItems.length === 0);
  setDisabled(ELEMENT_IDS.requestMedicineSelect, busy);
  setDisabled(ELEMENT_IDS.requestQuantity, busy);
  setDisabled(ELEMENT_IDS.requestAddItem, busy || requestItems.length >= 5);
}

async function loadRequestMedicines(): Promise<void> {
  if (requestMedicinesInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    requestMedicinesFailed = true;
    setRequestSubmitState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }
  requestMedicinesInFlight = true;
  requestMedicinesFailed = false;
  setRequestSubmitState('loading', 'جارٍ تحميل قائمة الأدوية…');
  try {
    const result = await api.medicines.list();
    requestMedicinesInFlight = false;
    if (!result.ok) {
      requestMedicinesFailed = true;
      setRequestSubmitState('error', result.error.message);
      return;
    }
    requestMedicines = result.value;
    requestMedicinesFailed = requestMedicines.length === 0;
    const select = document.getElementById(ELEMENT_IDS.requestMedicineSelect) as HTMLSelectElement | null;
    if (select !== null) {
      select.textContent = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'اختر الدواء';
      select.append(placeholder);
      for (const medicine of requestMedicines) {
        const option = document.createElement('option');
        option.value = medicine.id;
        option.textContent = medicine.name;
        select.append(option);
      }
    }
    setRequestSubmitState(
      requestMedicines.length === 0 ? 'error' : 'ready',
      requestMedicines.length === 0 ? 'لا توجد أدوية متاحة في القائمة.' : '',
    );
  } catch (error: unknown) {
    requestMedicinesInFlight = false;
    requestMedicinesFailed = true;
    setRequestSubmitState('error', 'تعذر تحميل قائمة الأدوية. يُرجى المحاولة مرة أخرى.');
  }
}

async function refreshSubmittedRequestStatus(): Promise<void> {
  const requestId = submittedRequestId;
  if (requestId === null || requestStatusInFlight || requestSubmissionInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setSubmittedRequestStatusState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  requestStatusInFlight = true;
  setSubmittedRequestStatusState('loading', 'جارٍ قراءة الحالة المخزنة للطلب…');
  setDisabled(ELEMENT_IDS.requestSubmit, true);
  try {
    const result = await api.orderRequests.get({ requestId });
    if (!result.ok) {
      setSubmittedRequestStatusState('error', result.error.message);
      return;
    }
    if (result.value.id !== requestId) {
      setSubmittedRequestStatusState('error', 'تعذر التحقق من حالة الطلب.');
      return;
    }
    setSubmittedRequestStatusState(
      'ready',
      `الحالة الحالية: ${labelOf(ORDER_REQUEST_STATUS_LABELS, result.value.status)}`,
    );
  } catch (error: unknown) {
    setSubmittedRequestStatusState('error', 'تعذر تحديث حالة الطلب. يُرجى المحاولة مرة أخرى.');
  } finally {
    requestStatusInFlight = false;
    const state = document.getElementById(ELEMENT_IDS.requestSubmitState)?.getAttribute('data-view-state');
    const busy = requestSubmissionInFlight;
    setDisabled(ELEMENT_IDS.requestStatusRefresh, submittedRequestId === null || busy);
    setDisabled(ELEMENT_IDS.requestSubmit, busy || requestItems.length === 0);
    setDisabled(ELEMENT_IDS.requestMedicineSelect, busy || state === 'loading');
    setDisabled(ELEMENT_IDS.requestQuantity, busy || state === 'loading');
    setDisabled(ELEMENT_IDS.requestAddItem, busy || state === 'loading' || requestItems.length >= 5);
  }
}

function renderRequestItems(): void {
  const rows = document.getElementById(ELEMENT_IDS.requestItems);
  if (rows === null) {
    return;
  }
  rows.textContent = '';
  for (const [index, item] of requestItems.entries()) {
    const row = document.createElement('tr');
    const medicineCell = document.createElement('td');
    const quantityCell = document.createElement('td');
    const actionCell = document.createElement('td');
    const medicine = requestMedicines?.find((candidate) => candidate.id === item.medicineId);
    medicineCell.textContent = medicine?.name ?? '';
    quantityCell.textContent = String(item.quantity);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.classList.toggle('button', true);
    remove.classList.toggle('button-ghost', true);
    remove.textContent = 'حذف';
    remove.addEventListener('click', () => {
      if (requestSubmissionInFlight) {
        return;
      }
      requestItems = requestItems.filter((_candidate, itemIndex) => itemIndex !== index);
      renderRequestItems();
      setRequestSubmitState('ready', '');
    });
    actionCell.append(remove);
    row.append(medicineCell, quantityCell, actionCell);
    rows.append(row);
  }
}

function addRequestItem(): void {
  if (requestSubmissionInFlight || requestItems.length >= 5) {
    return;
  }
  const select = document.getElementById(ELEMENT_IDS.requestMedicineSelect) as HTMLSelectElement | null;
  const quantityField = document.getElementById(ELEMENT_IDS.requestQuantity) as HTMLInputElement | null;
  const medicineId = select?.value ?? '';
  const quantityText = quantityField?.value ?? '';
  const quantity = Number(quantityText);
  if (
    requestMedicines?.some((medicine) => medicine.id === medicineId) !== true
    || quantityText.trim() === ''
    || !Number.isSafeInteger(quantity)
    || quantity <= 0
  ) {
    setRequestSubmitState('validation', 'اختر دواءً وأدخل كمية صحيحة أكبر من صفر.');
    return;
  }
  requestItems = [...requestItems, Object.freeze({ medicineId, quantity })];
  if (quantityField !== null) {
    quantityField.value = '';
  }
  renderRequestItems();
  setRequestSubmitState('ready', '');
}

async function submitOrderRequest(): Promise<void> {
  if (requestSubmissionInFlight || requestStatusInFlight) {
    return;
  }
  if (requestItems.length === 0) {
    setRequestSubmitState('validation', 'أضف دواءً واحدًا على الأقل قبل الإرسال.');
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setRequestSubmitState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  requestSubmissionInFlight = true;
  let refreshStatusAfterSubmit = false;
  setRequestSubmitState('submitting', 'جارٍ إنشاء الطلب…');
  try {
    const result = await api.orderRequests.submit({
      items: requestItems.map((item) => ({
        medicineId: item.medicineId,
        quantity: item.quantity,
      })),
    });
    if (!result.ok) {
      setRequestSubmitState('error', result.error.message);
      return;
    }
    submittedRequestId = result.value.requestId;
    setSubmittedRequestStatusState('idle', 'تم إنشاء الطلب؛ اقرأ حالته المخزنة أدناه.');
    refreshStatusAfterSubmit = true;
    requestItems = [];
    renderRequestItems();
    setRequestSubmitState(
      'success',
      `أُنشئ الطلب ${result.value.requestId} بنجاح. الطلب قيد الانتظار للمراجعة ولم تتم معالجته بعد.`,
    );
  } catch (error: unknown) {
    setRequestSubmitState('error', 'تعذر إرسال الطلب. يُرجى المحاولة مرة أخرى.');
  } finally {
    requestSubmissionInFlight = false;
    const region = document.getElementById(ELEMENT_IDS.requestSubmitState);
    const state = region?.getAttribute('data-view-state');
    const message = document.getElementById(ELEMENT_IDS.requestSubmitStateMessage)?.textContent ?? '';
    const finalState = state === 'error' || state === 'success' || state === 'validation' ? state : 'ready';
    setRequestSubmitState(finalState, message);
  }
  if (refreshStatusAfterSubmit) {
    await refreshSubmittedRequestStatus();
  }
}

async function loadOrders(reason: 'loading' | 'refreshing'): Promise<void> {
  if (ordersRequestInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setOrdersState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  ordersRequestInFlight = true;
  setOrdersState(reason, reason === 'loading' ? 'جارٍ تحميل الطلبات…' : 'جارٍ التحديث…');

  let result: ApplicationResult<readonly OrderRequestListItemView[]>;
  try {
    result = await api.orderRequests.list();
  } catch (error: unknown) {
    ordersRequestInFlight = false;
    setOrdersState('error', 'تعذر تحميل الطلبات. يُرجى المحاولة مرة أخرى.');
    return;
  }
  ordersRequestInFlight = false;

  if (!result.ok) {
    setOrdersState('error', result.error.message);
    return;
  }

  loadedOrders = result.value;
  if (loadedOrders.length === 0) {
    setOrdersState('empty', 'لا توجد طلبات مسجلة.');
  } else if (visibleOrders().length === 0) {
    setOrdersState('empty', 'لا توجد نتائج مطابقة للتصفية.');
  } else {
    setOrdersState('ready', '');
  }
  renderOrders();
}

/** Applies the search term locally. No request is sent. */
function applyOrderSearch(term: string): void {
  ordersSearchTerm = term;
  renderOrders();
  if (loadedOrders !== null && loadedOrders.length > 0) {
    const visible = visibleOrders();
    setOrdersState(
      visible.length === 0 ? 'empty' : 'ready',
      visible.length === 0 ? 'لا توجد نتائج مطابقة للبحث.' : '',
    );
  }
}

/**
 * Applies the status filter locally.
 *
 * An unrecognised value is treated as "no filter" rather than being trusted: the
 * `<select>` only offers known values, so anything else is a tampered DOM and
 * must widen the view, never narrow it to something unexpected.
 */
/** Shows the request dialog, tolerating a harness without `showModal`. */
function showOrderDialog(): void {
  const dialog = document.getElementById(ELEMENT_IDS.orderDialog) as (HTMLElement & { showModal?: () => void }) | null;
  if (dialog !== null && typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }
  setHidden(ELEMENT_IDS.orderDialog, false);
}

/** Closes the request dialog and drops the selection. */
function closeOrderDialog(): void {
  selectedOrder = null;
  orderProcessInFlight = false;
  setText(ELEMENT_IDS.orderOutcomeMessage, '');
  const dialog = document.getElementById(ELEMENT_IDS.orderDialog) as (HTMLElement & { close?: () => void }) | null;
  if (dialog !== null && typeof dialog.close === 'function') {
    dialog.close();
    return;
  }
  setHidden(ELEMENT_IDS.orderDialog, true);
}

/** Shows or clears the dialog's safe error region. */
function setOrderDialogError(message: string | null): void {
  setText(ELEMENT_IDS.orderDialogErrorMessage, message ?? '');
  setHidden(ELEMENT_IDS.orderDialogError, message === null);
}

/** Shows the outcome line after a processing attempt. */
function setOrderOutcomeMessage(message: string | null): void {
  setText(ELEMENT_IDS.orderOutcomeMessage, message ?? '');
  setHidden(ELEMENT_IDS.orderOutcomeMessage, message === null);
}

/**
 * Fills the request dialog from one loaded row.
 *
 * Everything written here is a stored field rendered verbatim. In particular the
 * item table shows each requested line AS STORED - no merge of duplicate medicine
 * ids and no total, because Stage 6 owns that and its verdict may differ.
 */
function fillOrderDialog(request: OrderRequestListItemView): void {
  setText(ELEMENT_IDS.orderDetailEmployee, orderEmployeeLabel(request));
  setText(ELEMENT_IDS.orderDetailDate, orderDateLabel(request.requestDateIso));
  setText(ELEMENT_IDS.orderDetailStatus, orderRequestStatusLabel(request.status));
  setText(ELEMENT_IDS.orderDetailOrderId, request.orderId ?? '—');
  setText(ELEMENT_IDS.orderDetailProcessedAt, orderDateLabel(request.processedAtIso));
  setText(ELEMENT_IDS.orderDetailProcessedBy, request.processedBy ?? '—');

  const items = document.getElementById(ELEMENT_IDS.orderDetailItems);
  if (items !== null) {
    items.textContent = '';
    for (const item of request.items) {
      const row = document.createElement('tr');
      appendOrderCell(row, item.medicineName);
      appendOrderCell(row, String(item.quantity));
      items.append(row);
    }
  }

  // `error` is the business sentence the processing engine committed to the
  // document, so it is safe and useful to show. It is never a transport error:
  // those are classified in Main and never reach this field.
  setText(ELEMENT_IDS.orderDetailFailureMessage, request.error ?? '');
  setHidden(ELEMENT_IDS.orderDetailFailure, request.error === null);

  // The processing action is offered ONLY for a pending request. This is
  // USABILITY, not authorization: firestore.rules still refuses a non-admin, and
  // the Stage 11 emulator suite proves it does.
  setDisabled(ELEMENT_IDS.orderProcess, request.status !== 'pending' || orderProcessInFlight);
  setHidden(ELEMENT_IDS.orderProcess, request.status !== 'pending');
}

/** Opens the request dialog for a loaded row. */
function openOrderDialog(requestId: string): void {
  const request = (loadedOrders ?? []).find((candidate) => candidate.id === requestId);
  if (request === undefined) {
    return;
  }
  selectedOrder = request;
  setOrderDialogError(null);
  setOrderOutcomeMessage(null);
  fillOrderDialog(request);
  showOrderDialog();
}

/**
 * Re-reads ONE request and shows what the server actually stored.
 *
 * Used after a processing attempt, where the answer to "did it work?" can only
 * come from the document. The list is also refreshed, because a status change
 * moves the row between filters.
 */
async function reloadSelectedOrder(): Promise<void> {
  const target = selectedOrder;
  if (target === null) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setOrderDialogError(BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  let result: ApplicationResult<OrderRequestListItemView>;
  try {
    result = await api.orderRequests.get({ requestId: target.id });
  } catch (error: unknown) {
    // A THROWN bridge error is not an envelope. It is caught here rather than
    // left to reject into an unhandled rejection, which would leave the dialog
    // showing the PRE-write row while claiming the read succeeded.
    setOrderDialogError('تعذر تحديث حالة الطلب. يُرجى المحاولة مرة أخرى.');
    return;
  }
  if (!result.ok) {
    setOrderDialogError(result.error.message);
    return;
  }

  // The employee name is PRESENTATION-ONLY enrichment that only the list call
  // performs, so the single-request read may answer without one. Replacing the
  // cached row outright would therefore blank a name the manager was reading a
  // moment ago. The stored document remains the source of truth for everything
  // else - only the absent label is carried over.
  const authoritative = result.value.employeeName === null
    ? { ...result.value, employeeName: target.employeeName }
    : result.value;

  // Merge the authoritative row into the cache so the table agrees with the
  // dialog even if the row has just left the current filter.
  loadedOrders = (loadedOrders ?? []).map((row) => (row.id === authoritative.id ? authoritative : row));
  selectedOrder = authoritative;
  fillOrderDialog(authoritative);
  renderOrders();
}

/** Shows the confirmation dialog, tolerating a harness without `showModal`. */
function showOrderConfirmDialog(): void {
  const dialog = document.getElementById(ELEMENT_IDS.orderConfirmDialog) as (HTMLElement & { showModal?: () => void }) | null;
  if (dialog !== null && typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }
  setHidden(ELEMENT_IDS.orderConfirmDialog, false);
}

/** Closes the confirmation dialog. Processing has NOT been cancelled or started. */
function closeOrderConfirmDialog(): void {
  const dialog = document.getElementById(ELEMENT_IDS.orderConfirmDialog) as (HTMLElement & { close?: () => void }) | null;
  if (dialog !== null && typeof dialog.close === 'function') {
    dialog.close();
    return;
  }
  setHidden(ELEMENT_IDS.orderConfirmDialog, true);
}

/** Whether the confirmation dialog is on screen. */
function orderConfirmOpen(): boolean {
  const dialog = document.getElementById(ELEMENT_IDS.orderConfirmDialog);
  return dialog !== null && dialog.hidden === false;
}

/**
 * Opens the confirmation for one pending request.
 *
 * The dialog identifies the request well enough for a manager to recognise it -
 * employee, date and the requested lines - all read from the stored document.
 * It deliberately shows NO estimated stock, NO total and NO predicted result:
 * the renderer cannot compute those, and predicting an outcome would be exactly
 * the second algorithm this stage must not have.
 */
function confirmOrderProcessing(requestId: string): void {
  const request = selectedOrder;
  if (request === null || request.id !== requestId) {
    return;
  }
  // Only a pending request may be confirmed. A processed or failed one would be
  // refused by Stage 6 as already-processed, so it is never offered.
  if (request.status !== 'pending') {
    return;
  }

  setText(ELEMENT_IDS.orderConfirmEmployee, orderEmployeeLabel(request));
  setText(ELEMENT_IDS.orderConfirmDate, orderDateLabel(request.requestDateIso));
  setText(ELEMENT_IDS.orderConfirmItems, String(request.items.length));
  setText(
    ELEMENT_IDS.orderConfirmItemsDetail,
    request.items.map((item) => `${item.medicineName} × ${item.quantity}`).join('، '),
  );
  setDisabled(ELEMENT_IDS.orderConfirmAccept, orderProcessInFlight);
  showOrderConfirmDialog();
}

/**
 * Forwards ONE request id to the Stage 6 service and reports what came back.
 *
 * THE FOUR OUTCOMES ARE HANDLED SEPARATELY, because they mean different things:
 *
 *  1. `processed`   - W1-W5 committed. The order id is shown, and both the
 *                     request and the queue are re-read so the screen can only
 *                     ever show what the server stored.
 *  2. `rejected`    - a business rule refused the request AND Stage 6 committed
 *                     the `failed` marker. This is a COMPLETED attempt, not a
 *                     transport failure: the request MUST be re-read, because its
 *                     status has just changed to `failed` on the server.
 *  3. `already-processed` - Stage 6 wrote NOTHING. No order id is shown and no
 *                     success is claimed; the request is re-read so the manager
 *                     sees its real current state instead.
 *  4. a failed `ApplicationResult` - a rules denial, a conflict or a transport
 *                     failure. Nothing is claimed, and the request is re-read
 *                     anyway so the true state is visible.
 *
 * In every case the list is refreshed too, because a status change moves the row
 * between the status filter's groups.
 */
async function submitOrderProcessing(): Promise<void> {
  if (orderProcessInFlight || selectedOrder === null) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setOrderDialogError(BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  const target = selectedOrder;
  if (target.status !== 'pending') {
    // Belt and braces: the button is already hidden, but the function refuses too.
    return;
  }

  orderProcessInFlight = true;
  setOrdersState('saving', 'جارٍ معالجة الطلب…');
  setOrderDialogError(null);
  setOrderOutcomeMessage(null);
  setDisabled(ELEMENT_IDS.orderProcess, true);
  setDisabled(ELEMENT_IDS.orderConfirmAccept, true);

  let result: ApplicationResult<OrderProcessingOutcomeView>;
  try {
    result = await api.orders.process({ requestId: target.id });
  } catch (error: unknown) {
    // Nothing is claimed. The real state is re-read rather than assumed.
    orderProcessInFlight = false;
    setOrderDialogError('تعذر تنفيذ العملية. يُرجى المحاولة مرة أخرى.');
    setOrdersState('ready', '');
    setDisabled(ELEMENT_IDS.orderConfirmAccept, false);
    await reloadSelectedOrder();
    await loadOrders('refreshing');
    return;
  }
  orderProcessInFlight = false;
  setDisabled(ELEMENT_IDS.orderConfirmAccept, false);

  if (!result.ok) {
    setOrderDialogError(result.error.message);
    setOrdersState('ready', '');
    await reloadSelectedOrder();
    await loadOrders('refreshing');
    return;
  }

  closeOrderConfirmDialog();

  if (result.value.outcome === 'processed') {
    setOrderOutcomeMessage(`تمت معالجة الطلب بنجاح. رقم الطلب الناتج: ${result.value.orderId}`);
  } else if (result.value.outcome === 'rejected') {
    setOrderOutcomeMessage(`رُفض الطلب: ${result.value.reason}`);
  } else {
    // Already processed. NO order id, NO success claim - Stage 6 wrote nothing,
    // and inventing a result here would be a lie the manager acts on.
    setOrderOutcomeMessage('سبق أن تمت معالجة هذا الطلب، ولم تُنفَّذ أي كتابة جديدة.');
  }

  // Always re-read: this is the only way the screen learns the true status, and
  // it is required after `rejected` (a `failed` marker was committed) and after
  // `already-processed` (nothing was written).
  await reloadSelectedOrder();
  setOrdersState('ready', '');
  await loadOrders('refreshing');
}

/**
 * Applies the status filter locally.
 *
 * An unrecognised value is treated as "no filter" rather than being trusted: the
 * `<select>` only offers known values, so anything else is a tampered DOM and
 * must widen the view, never narrow it to something unexpected.
 */
function applyOrderStatusFilter(value: string): void {
  ordersStatusFilter = ORDER_STATUS_FILTER_VALUES.has(value) ? value : 'all';
  renderOrders();
  if (loadedOrders !== null && loadedOrders.length > 0) {
    const visible = visibleOrders();
    setOrdersState(
      visible.length === 0 ? 'empty' : 'ready',
      visible.length === 0 ? 'لا توجد نتائج مطابقة للتصفية.' : '',
    );
  }
}

// ===========================================================================
// Stage 14 - the STOCK MOVEMENT AUDIT page (READ-ONLY).
//
// THE WHOLE MODULE IS AN INSPECTION SURFACE
// Every function below either reads from the loaded array or writes the DOM. The
// single transport call in the entire module is `api.stockLogs.list()`, and it
// takes no argument. There is no create, update, delete or append here.
//
// NO ARITHMETIC OVER QUANTITIES - THE RULE THIS SCREEN EXISTS TO RESPECT
// `quantity` is a POSITIVE MAGNITUDE in both directions (A4 stores Math.abs), and
// `type` alone carries the sign. Therefore:
//   - no summation, no netting, no running balance;
//   - no "total inward" / "total outward" footer;
//   - no stock figure of any kind, and above all no `totalInward - totalOutward`,
//     which would publish a number the database never stored.
// The current balance lives in `medicines.stock` as a STORED field; this screen
// does not reproduce it and does not second-guess it.
//
// NO ORDERING IS CLAIMED
// The REST transport has no `orderBy`, so the rows arrive in server order. Nothing
// here sorts them, and no column header implies a chronology. Each row shows its
// OWN stored timestamp, which is the only date claim that is actually true.
//
// THE SEARCH AND THE FILTER ARE LOCAL
// Both act on the already-loaded array and issue no request - the same pattern
// the Stage 11 queue and the Stage 12 history use.
// ===========================================================================

/** Arabic labels for the two stored movement types. A table, not a rule. */
const STOCK_MOVEMENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  inward: 'وارد للمخزون',
  outward: 'صادر من المخزون',
});

/** The filter values the direction select accepts; anything else means "all". */
const STOCK_DIRECTION_FILTER_VALUES: ReadonlySet<string> = new Set<string>([
  'all', 'inward', 'outward',
]);

/** The stored direction, translated. An unknown value degrades to the dash. */
function stockMovementLabel(type: string): string {
  return STOCK_MOVEMENT_LABELS[type] ?? UNKNOWN_LABEL;
}

/** A stored ISO timestamp, or the neutral dash when it is genuinely absent. */
function stockDateLabel(iso: string): string {
  return typeof iso === 'string' && iso.length > 0 ? iso : UNKNOWN_LABEL;
}

/** The stored descriptive label, falling back to the medicine id, never to a guess. */
function stockDescriptionLabel(movement: StockLogView): string {
  return movement.label.trim().length > 0 ? movement.label : movement.medicineId;
}

/** The reference a movement carries: its order, else its request, else the dash. */
function stockReferenceLabel(movement: StockLogView): string {
  if (movement.orderId !== null && movement.orderId.length > 0) {
    return movement.orderId;
  }
  if (movement.requestId !== null && movement.requestId.length > 0) {
    return movement.requestId;
  }
  return UNKNOWN_LABEL;
}
/**
 * The rows currently visible, after the direction filter and the search term.
 *
 * Filtering is LOCAL: the page is already fully loaded, so a keystroke needs no
 * query, and sending one would add round trips for a collection the transport
 * could not filter by anyway.
 */
function visibleStockMovements(): readonly StockLogView[] {
  const all = loadedStockMovements ?? [];
  const filtered = stockDirectionFilter === 'all'
    ? all
    : all.filter((movement) => movement.type === stockDirectionFilter);
  const needle = normalizeForSearch(stockSearchTerm);
  if (needle.length === 0) {
    return filtered;
  }
  // The medicine id, the stored descriptive label, the movement id and the
  // reference are all searchable: an audit surface is where a manager pastes an
  // identifier from somewhere else.
  return filtered.filter((movement) => {
    if (normalizeForSearch(movement.medicineId).includes(needle)) {
      return true;
    }
    if (normalizeForSearch(stockDescriptionLabel(movement)).includes(needle)) {
      return true;
    }
    if (normalizeForSearch(movement.id).includes(needle)) {
      return true;
    }
    if (movement.orderId !== null && normalizeForSearch(movement.orderId).includes(needle)) {
      return true;
    }
    if (movement.requestId !== null && normalizeForSearch(movement.requestId).includes(needle)) {
      return true;
    }
    return false;
  });
}

/** Renders the whole movement table from the loaded data. */
function renderStockMovements(): void {
  const rows = document.getElementById(ELEMENT_IDS.stockRows);
  if (rows === null) {
    return;
  }
  rows.textContent = '';

  for (const movement of visibleStockMovements()) {
    const row = document.createElement('tr');
    row.setAttribute('data-stock-log-id', movement.id);
    appendHistoryCell(row, movement.medicineId);
    appendHistoryCell(row, stockDescriptionLabel(movement));
    appendHistoryCell(row, stockMovementLabel(movement.type));
    // The STORED magnitude, printed on its own. No sign is prepended here: the
    // direction column already carries it, and inventing a +/- would duplicate
    // (and risk contradicting) the stored value.
    appendHistoryCell(row, String(movement.quantity), 'cell-number');
    appendHistoryCell(row, stockDateLabel(movement.dateIso), 'value-ltr');
    // The uid is shown as an identifier only. Resolving it to a name would mean
    // reading every profile, which is admin-only, and would be decoration.
    appendHistoryCell(row, movement.actorUid ?? UNKNOWN_LABEL);
    appendHistoryCell(row, stockReferenceLabel(movement));

    rows.append(row);
  }

  const total = loadedStockMovements === null ? 0 : loadedStockMovements.length;
  const shown = visibleStockMovements().length;
  setText(
    ELEMENT_IDS.stockCount,
    stockSearchTerm.trim().length === 0 && stockDirectionFilter === 'all'
      ? `عدد الحركات: ${total}`
      : `عدد النتائج: ${shown} من ${total}`,
  );
}

/** Sets the movement page state, keeping rows visible while busy. */
function setStockState(state: UsersViewState, message: string): void {
  const region = document.getElementById(ELEMENT_IDS.stockState);
  region?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.stockStateMessage, message);
  setHidden(ELEMENT_IDS.stockRetry, state !== 'error');
  const busy = state === 'loading' || state === 'refreshing';
  setDisabled(ELEMENT_IDS.stockRefresh, busy);
}
/**
 * Reads the movement trail through the single named, payload-free operation.
 *
 * A THROWN bridge error is handled like a failed envelope: nothing is claimed, and
 * no stale-but-plausible rows are left on screen pretending to be fresh.
 */
async function loadStockMovements(reason: 'loading' | 'refreshing'): Promise<void> {
  if (stockMovementsInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setStockState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  stockMovementsInFlight = true;
  setStockState(reason, reason === 'loading' ? 'جارٍ تحميل سجل الحركة…' : 'جارٍ التحديث…');

  let result: ApplicationResult<readonly StockLogView[]>;
  try {
    result = await api.stockLogs.list();
  } catch (error: unknown) {
    stockMovementsInFlight = false;
    // Same rule as a failed envelope: a thrown bridge error must not leave rows
    // from a previous successful read sitting on screen as if they were fresh.
    loadedStockMovements = null;
    renderStockMovements();
    setStockState('error', 'تعذر تحميل سجل حركة المخزون. يُرجى المحاولة مرة أخرى.');
    return;
  }
  stockMovementsInFlight = false;

  if (!result.ok) {
    // The rows are CLEARED, not merely covered by an error message. A failed
    // refresh that leaves yesterday's rows on screen would let a manager read an
    // audit trail that no longer reflects anything the server just said - and an
    // audit surface must never show data it cannot vouch for.
    loadedStockMovements = null;
    renderStockMovements();
    setStockState('error', result.error.message);
    return;
  }

  loadedStockMovements = result.value;
  if (loadedStockMovements.length === 0) {
    setStockState('empty', 'لا توجد حركات مخزون مسجّلة.');
  } else if (visibleStockMovements().length === 0) {
    setStockState('empty', 'لا توجد نتائج مطابقة للتصفية.');
  } else {
    setStockState('ready', '');
  }
  renderStockMovements();
}

/** Applies the direction filter locally. No request is sent. */
function applyStockDirectionFilter(value: string): void {
  // An unrecognised value means "no filter" rather than being trusted: the
  // `<select>` only offers known values, so anything else is a tampered DOM and
  // must widen the view, never narrow it to something unexpected.
  stockDirectionFilter = STOCK_DIRECTION_FILTER_VALUES.has(value) ? value : 'all';
  renderStockMovements();
  if (loadedStockMovements !== null && loadedStockMovements.length > 0) {
    const visible = visibleStockMovements();
    setStockState(
      visible.length === 0 ? 'empty' : 'ready',
      visible.length === 0 ? 'لا توجد نتائج مطابقة للتصفية.' : '',
    );
  }
}
//
// THE WHOLE MODULE IS AN INSPECTION SURFACE
// Every function below either reads from the loaded array or writes the DOM.
// The single transport call in the entire module is `api.orders.list()`, and it
// takes no argument. There is no create, update or delete here, no
// `orders.process` (that stays on the Stage 11 page where a request is actually
// processed), and no arithmetic over quantities - `itemCount` arrives already
// counted from Main.
//
// NOTHING IS DERIVED
// The month column shows the value the application projected from the stored
// `monthYear`; the renderer does not compute a month, a total or a stock figure.
// A missing value becomes the neutral dash rather than a guess.
// ===========================================================================

/** The employee label: the resolved name when present, else the stored uid. */
function orderHistoryEmployeeLabel(order: OrderHistoryItemView): string {
  return order.employeeName !== null && order.employeeName.trim().length > 0
    ? order.employeeName
    : order.userId;
}

/** The stored status, translated. An unknown value degrades to the neutral dash. */
function orderHistoryStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? UNKNOWN_LABEL;
}

/** A stored ISO timestamp, or the neutral dash when it is genuinely absent. */
function orderHistoryDateLabel(iso: string | null): string {
  return typeof iso === 'string' && iso.length > 0 ? iso : UNKNOWN_LABEL;
}

/**
 * The rows currently visible, after the status filter and the search term.
 *
 * Filtering is LOCAL for the same reason as the Stage 11 queue: the page is
 * already fully loaded, so a keystroke needs no query, and sending one would add
 * round trips and would be refused by firestore.rules for anyone but an admin.
 */
function visibleOrderHistory(): readonly OrderHistoryItemView[] {
  const all = loadedOrderHistory ?? [];
  const filtered = ordersHistoryStatusFilter === 'all'
    ? all
    : all.filter((order) => order.status === ordersHistoryStatusFilter);
  const needle = normalizeForSearch(ordersHistorySearchTerm);
  if (needle.length === 0) {
    return filtered;
  }
  // Matches the employee (name AND uid, since either may be all there is), the
  // order id (an audit surface is where a manager pastes an id from elsewhere)
  // and any medicine named on the order.
  return filtered.filter((order) => {
    if (normalizeForSearch(orderHistoryEmployeeLabel(order)).includes(needle)) {
      return true;
    }
    if (normalizeForSearch(order.userId).includes(needle)) {
      return true;
    }
    if (normalizeForSearch(order.id).includes(needle)) {
      return true;
    }
    return order.items.some((item) => normalizeForSearch(item.medicineName).includes(needle));
  });
}

/** Renders one history row cell. */
function appendHistoryCell(row: HTMLTableRowElement, text: string, className?: string): void {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className !== undefined) {
    cell.setAttribute('class', className);
  }
  row.append(cell);
}

/** Renders the whole history table from the loaded data. */
function renderOrderHistory(): void {
  const rows = document.getElementById(ELEMENT_IDS.ordersHistoryRows);
  if (rows === null) {
    return;
  }
  rows.textContent = '';

  for (const order of visibleOrderHistory()) {
    const row = document.createElement('tr');
    row.setAttribute('data-order-id', order.id);
    appendHistoryCell(row, orderHistoryEmployeeLabel(order));
    appendHistoryCell(row, order.id);
    appendHistoryCell(row, orderHistoryDateLabel(order.dateIso));
    // The application already normalised this for display; the renderer shows it
    // verbatim and never recomputes a month from the ISO date.
    appendHistoryCell(row, order.monthYearDisplay ?? UNKNOWN_LABEL);
    appendHistoryCell(row, orderHistoryStatusLabel(order.status));
    // A COUNT of lines, exactly as Main counted them. Summing the quantities here
    // would duplicate - and could contradict - Stage 6's own aggregation.
    appendHistoryCell(row, String(order.itemCount), 'cell-number');
    appendHistoryCell(row, order.requestId ?? UNKNOWN_LABEL);

    const actions = document.createElement('td');
    const open = document.createElement('button');
    open.setAttribute('type', 'button');
    open.setAttribute('class', 'button button-ghost');
    open.setAttribute('data-order-id', order.id);
    open.textContent = 'عرض';
    open.addEventListener('click', () => {
      openOrderHistoryDialog(order.id);
    });
    actions.append(open);
    row.append(actions);

    rows.append(row);
  }

  const total = loadedOrderHistory === null ? 0 : loadedOrderHistory.length;
  const shown = visibleOrderHistory().length;
  setText(
    ELEMENT_IDS.ordersHistoryCount,
    ordersHistorySearchTerm.trim().length === 0 && ordersHistoryStatusFilter === 'all'
      ? `عدد الطلبات المحمّلة: ${total}`
      : `عدد النتائج: ${shown} من ${total} طلب محمّل`,
  );
  setText(ELEMENT_IDS.ordersHistoryLoadMoreState, ordersHistoryLoadMoreMessage);
  setHidden(ELEMENT_IDS.ordersHistoryLoadMore, !ordersHistoryHasMore);
  setDisabled(ELEMENT_IDS.ordersHistoryLoadMore, ordersHistoryLoadMoreInFlight || !ordersHistoryHasMore);
  setDisabled(ELEMENT_IDS.ordersHistoryRefresh, ordersHistoryInFlight || ordersHistoryLoadMoreInFlight);
  setText(
    ELEMENT_IDS.ordersHistoryLoadMore,
    ordersHistoryLoadMoreInFlight
      ? 'جارٍ تحميل المزيد…'
      : ordersHistoryLoadMoreMessage.length > 0 && ordersHistoryLoadMoreRetryable
        ? 'إعادة محاولة تحميل المزيد'
        : 'تحميل المزيد',
  );
}

/** Sets the history page state, keeping rows visible while busy. */
function setOrderHistoryState(state: UsersViewState, message: string): void {
  const region = document.getElementById(ELEMENT_IDS.ordersHistoryState);
  region?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.ordersHistoryStateMessage, message);
  setHidden(ELEMENT_IDS.ordersHistoryRetry, state !== 'error');
  const busy = state === 'loading' || state === 'refreshing';
  setDisabled(ELEMENT_IDS.ordersHistoryRefresh, busy);
}

function printOrderHistoryReport(): void {
  if (loadedOrderHistory === null) {
    return;
  }

  const orders = visibleOrderHistory();
  const statusLabels: Readonly<Record<string, string>> = {
    all: 'كل الحالات',
    pending: 'قيد الانتظار',
    accepted: 'مقبول',
    rejected: 'مرفوض',
  };
  const search = ordersHistorySearchTerm.trim();
  setText(ELEMENT_IDS.ordersHistoryReportTitle, 'تقرير سجل الطلبات الإداري');
  setText(
    ELEMENT_IDS.ordersHistoryReportGeneratedAt,
    `تاريخ ووقت إنشاء التقرير: ${new Date().toLocaleString('ar')}`,
  );
  setText(
    ELEMENT_IDS.ordersHistoryReportFilters,
    `البحث: ${search.length > 0 ? search : 'بدون'}؛ الحالة: ${statusLabels[ordersHistoryStatusFilter] ?? 'كل الحالات'}`,
  );
  setText(ELEMENT_IDS.ordersHistoryReportCount, `عدد النتائج المعروضة: ${orders.length}`);
  setText(
    ELEMENT_IDS.ordersHistoryReportScope,
    `يشمل التقرير الطلبات المحمّلة والمصفّاة محليًا حاليًا${ordersHistoryHasMore ? '؛ قد تتوفر صفحات إضافية' : ''}؛ لا يُضمن الترتيب الزمني أو اتساق اللقطة عند تغيّر البيانات بين تحميل الصفحات.`,
  );
  setText(
    ELEMENT_IDS.ordersHistoryReportEmpty,
    loadedOrderHistory.length === 0
      ? 'لا توجد طلبات في نافذة سجل الطلبات المحمّلة.'
      : 'لا توجد طلبات تطابق عوامل التصفية ضمن نافذة السجل المحمّلة.',
  );
  setHidden(ELEMENT_IDS.ordersHistoryReportEmpty, orders.length > 0);

  document.body.dataset['printView'] = 'orders-history';
  try {
    window.print();
  } finally {
    delete document.body.dataset['printView'];
  }
}

/**
 * Reads the history through the single named, payload-free operation.
 *
 * A THROWN bridge error is handled like a failed envelope: nothing is claimed,
 * and no stale-but-plausible rows are left on screen pretending to be fresh.
 */
async function loadOrderHistory(reason: 'loading' | 'refreshing'): Promise<void> {
  if (ordersHistoryInFlight || ordersHistoryLoadMoreInFlight) {
    return;
  }
  const requestGeneration = ordersHistoryRequestGeneration;
  const ownerUid = currentAuthState?.uid ?? null;
  if (ownerUid === null) {
    setOrderHistoryState('error', 'تعذر التحقق من جلسة المستخدم. يُرجى تسجيل الدخول من جديد.');
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setOrderHistoryState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  ordersHistoryInFlight = true;
  ordersHistoryHasMore = false;
  ordersHistoryLoadMoreMessage = '';
  ordersHistoryLoadMoreRetryable = false;
  renderOrderHistory();
  setOrderHistoryState(reason, reason === 'loading' ? 'جارٍ تحميل السجل…' : 'جارٍ التحديث…');

  let result: ApplicationResult<OrderHistoryPageView>;
  try {
    result = await api.orders.list();
  } catch (error: unknown) {
    if (!isCurrentOrderHistoryRequest(requestGeneration, ownerUid)) {
      return;
    }
    ordersHistoryInFlight = false;
    setOrderHistoryState('error', 'تعذر تحميل سجل الطلبات. يُرجى المحاولة مرة أخرى.');
    return;
  }
  if (!isCurrentOrderHistoryRequest(requestGeneration, ownerUid)) {
    return;
  }
  ordersHistoryInFlight = false;

  if (!result.ok) {
    setOrderHistoryState('error', result.error.message);
    return;
  }

  loadedOrderHistory = mergeOrderHistoryPages([], result.value.orders);
  ordersHistoryHasMore = result.value.hasMore;
  // The selection may refer to a row a refresh no longer returns, so it is
  // dropped rather than left pointing at a document that is not on screen.
  const selectedId = selectedOrderHistory?.id ?? null;
  if (selectedId !== null && !loadedOrderHistory.some((order) => order.id === selectedId)) {
    selectedOrderHistory = null;
  }
  setOrderHistoryState('idle', '');
  renderOrderHistory();
  setOrderHistoryDataState();
}

async function loadMoreOrderHistory(): Promise<void> {
  if (
    ordersHistoryInFlight
    || ordersHistoryLoadMoreInFlight
    || !ordersHistoryHasMore
    || loadedOrderHistory === null
  ) {
    return;
  }
  const requestGeneration = ordersHistoryRequestGeneration;
  const ownerUid = currentAuthState?.uid ?? null;
  if (ownerUid === null) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    ordersHistoryLoadMoreMessage = BRIDGE_UNAVAILABLE_MESSAGE;
    ordersHistoryLoadMoreRetryable = true;
    renderOrderHistory();
    return;
  }

  ordersHistoryLoadMoreInFlight = true;
  ordersHistoryLoadMoreMessage = '';
  ordersHistoryLoadMoreRetryable = false;
  renderOrderHistory();
  let result: ApplicationResult<OrderHistoryPageView>;
  try {
    result = await api.orders.loadMore();
  } catch (error: unknown) {
    if (!isCurrentOrderHistoryRequest(requestGeneration, ownerUid)) {
      return;
    }
    ordersHistoryLoadMoreMessage = 'تعذر تحميل الصفحة التالية. أعد المحاولة أو حدّث السجل.';
    ordersHistoryLoadMoreRetryable = true;
    ordersHistoryLoadMoreInFlight = false;
    renderOrderHistory();
    return;
  }
  if (!isCurrentOrderHistoryRequest(requestGeneration, ownerUid)) {
    return;
  }
  ordersHistoryLoadMoreInFlight = false;
  if (!result.ok) {
    ordersHistoryLoadMoreMessage = result.error.message;
    ordersHistoryLoadMoreRetryable = result.error.retryable;
    if (!result.error.retryable) {
      ordersHistoryHasMore = false;
    }
    renderOrderHistory();
    return;
  }

  loadedOrderHistory = mergeOrderHistoryPages(loadedOrderHistory, result.value.orders);
  ordersHistoryHasMore = result.value.hasMore;
  ordersHistoryLoadMoreMessage = '';
  ordersHistoryLoadMoreRetryable = false;
  renderOrderHistory();
  setOrderHistoryDataState();
}

function visibleMyOrderHistory(): readonly PersonalOrderHistoryItemView[] {
  const all = loadedMyOrderHistory ?? [];
  const byStatus = myOrdersStatusFilter === 'all'
    ? all
    : all.filter((order) => order.status === myOrdersStatusFilter);
  const needle = normalizeForSearch(myOrdersSearchTerm);
  if (needle.length === 0) {
    return byStatus;
  }
  return byStatus.filter((order) => {
    if (normalizeForSearch(order.id).includes(needle)) {
      return true;
    }
    return order.items.some((item) => normalizeForSearch(item.medicineName).includes(needle));
  });
}

function renderMyOrderHistory(): void {
  const rows = document.getElementById(ELEMENT_IDS.myOrdersRows);
  if (rows === null) {
    return;
  }
  rows.textContent = '';
  const orders = visibleMyOrderHistory();
  for (const order of orders) {
    const row = document.createElement('tr');
    row.setAttribute('data-order-id', order.id);
    appendHistoryCell(row, order.id);
    appendHistoryCell(row, orderHistoryDateLabel(order.dateIso));
    appendHistoryCell(row, order.monthYearDisplay ?? UNKNOWN_LABEL);
    appendHistoryCell(row, orderHistoryStatusLabel(order.status));
    appendHistoryCell(row, String(order.itemCount), 'cell-number');
    appendHistoryCell(
      row,
      order.items.map((item) => `${item.medicineName} × ${item.quantity}`).join('، '),
    );
    rows.append(row);
  }

  const total = loadedMyOrderHistory === null ? 0 : loadedMyOrderHistory.length;
  const shown = orders.length;
  setText(
    ELEMENT_IDS.myOrdersCount,
    myOrdersSearchTerm.trim().length === 0 && myOrdersStatusFilter === 'all'
      ? `عدد الطلبات في هذه النافذة: ${total}`
      : `عدد النتائج: ${shown} من ${total}`,
  );

  if (myOrderHistoryViewState === 'loading'
    || myOrderHistoryViewState === 'refreshing'
    || myOrderHistoryViewState === 'error') {
    return;
  }
  if (loadedMyOrderHistory === null) {
    setMyOrderHistoryState('idle', '');
    return;
  }
  if (loadedMyOrderHistory.length === 0) {
    setMyOrderHistoryState('empty', 'لا توجد طلبات منفَّذة في هذه النافذة.');
    return;
  }
  if (shown === 0) {
    setMyOrderHistoryState(
      'empty',
      'لا توجد طلبات مطابقة للبحث أو الفلتر الحالي في هذه النافذة.',
    );
    return;
  }
  setMyOrderHistoryState('ready', '');
}

function setMyOrderHistoryState(state: UsersViewState, message: string): void {
  myOrderHistoryViewState = state;
  const region = document.getElementById(ELEMENT_IDS.myOrdersState);
  region?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.myOrdersStateMessage, message);
  setHidden(ELEMENT_IDS.myOrdersRetry, state !== 'error');
  const busy = state === 'loading' || state === 'refreshing';
  setDisabled(ELEMENT_IDS.myOrdersRefresh, busy);
}

function printMyOrderHistoryReport(): void {
  if (loadedMyOrderHistory === null) {
    return;
  }

  const orders = visibleMyOrderHistory();
  const statusLabels: Readonly<Record<string, string>> = {
    all: 'كل الحالات',
    pending: 'قيد الانتظار',
    accepted: 'مقبول',
    rejected: 'مرفوض',
  };
  const search = myOrdersSearchTerm.trim();
  setText(ELEMENT_IDS.myOrdersReportTitle, 'تقرير طلباتي المنفَّذة');
  setText(
    ELEMENT_IDS.myOrdersReportGeneratedAt,
    `تاريخ ووقت إنشاء التقرير: ${new Date().toLocaleString('ar')}`,
  );
  setText(
    ELEMENT_IDS.myOrdersReportFilters,
    `البحث: ${search.length > 0 ? search : 'بدون'}؛ الحالة: ${statusLabels[myOrdersStatusFilter] ?? 'كل الحالات'}`,
  );
  setText(ELEMENT_IDS.myOrdersReportCount, `عدد النتائج المعروضة: ${orders.length}`);
  setText(
    ELEMENT_IDS.myOrdersReportScope,
    'يقتصر هذا التقرير على نافذة السجل المحدودة المحمّلة حاليًا، ولا يضمن ترتيبًا زمنيًا.',
  );
  setText(
    ELEMENT_IDS.myOrdersReportEmpty,
    loadedMyOrderHistory.length === 0
      ? 'لا توجد طلبات في النافذة المحمّلة.'
      : 'لا توجد طلبات تطابق عوامل التصفية ضمن النافذة المحمّلة.',
  );
  setHidden(ELEMENT_IDS.myOrdersReportEmpty, orders.length > 0);
  window.print();
}

/** Reads the current user's bounded, unsorted history through the named preload operation. */
async function loadMyOrderHistory(reason: 'loading' | 'refreshing'): Promise<void> {
  if (myOrderHistoryInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setMyOrderHistoryState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  myOrderHistoryInFlight = true;
  setMyOrderHistoryState(reason, reason === 'loading' ? 'جارٍ تحميل سجل طلباتك…' : 'جارٍ تحديث سجل طلباتك…');
  let result: ApplicationResult<readonly PersonalOrderHistoryItemView[]>;
  try {
    result = await api.orders.myHistory();
  } catch (error: unknown) {
    myOrderHistoryInFlight = false;
    setMyOrderHistoryState('error', 'تعذر تحميل سجل طلباتك. يُرجى المحاولة مرة أخرى.');
    return;
  }
  myOrderHistoryInFlight = false;
  if (!result.ok) {
    setMyOrderHistoryState('error', result.error.message);
    return;
  }

  loadedMyOrderHistory = result.value;
  setMyOrderHistoryState('idle', '');
  renderMyOrderHistory();
}

/** Fills the read-only details dialog from one loaded row. */
function fillOrderHistoryDialog(order: OrderHistoryItemView): void {
  setText(ELEMENT_IDS.orderHistoryDetailId, order.id);
  setText(ELEMENT_IDS.orderHistoryDetailEmployee, orderHistoryEmployeeLabel(order));
  setText(ELEMENT_IDS.orderHistoryDetailDate, orderHistoryDateLabel(order.dateIso));
  setText(ELEMENT_IDS.orderHistoryDetailMonth, order.monthYearDisplay ?? UNKNOWN_LABEL);
  setText(ELEMENT_IDS.orderHistoryDetailStatus, orderHistoryStatusLabel(order.status));
  setText(ELEMENT_IDS.orderHistoryDetailException, order.isExceptionOrder ? 'نعم' : 'لا');
  // `null` means the order predates the Stage 6 back-reference, so the neutral
  // dash is shown rather than an invented request id.
  setText(ELEMENT_IDS.orderHistoryDetailRequest, order.requestId ?? UNKNOWN_LABEL);

  const items = document.getElementById(ELEMENT_IDS.orderHistoryDetailItems);
  if (items !== null) {
    items.textContent = '';
    for (const item of order.items) {
      const row = document.createElement('tr');
      // The medicine name is the SNAPSHOT stored on the order at write time. It
      // is never re-resolved from `medicines`: a renamed medicine must not
      // rewrite what a historical order actually said.
      appendHistoryCell(row, item.medicineName);
      appendHistoryCell(row, String(item.quantity), 'cell-number');
      items.append(row);
    }
  }
}

function setOrderHistoryMovementsState(
  state: 'idle' | 'loading' | 'empty' | 'ready' | 'error',
  message: string,
): void {
  document.getElementById(ELEMENT_IDS.orderHistoryMovementsState)
    ?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.orderHistoryMovementsStateMessage, message);
  setHidden(ELEMENT_IDS.orderHistoryMovementsTableWrap, state !== 'ready');
}

function renderOrderHistoryMovements(movements: readonly StockLogView[]): void {
  const rows = document.getElementById(ELEMENT_IDS.orderHistoryMovementsRows);
  if (rows === null) {
    return;
  }
  rows.textContent = '';
  for (const movement of movements) {
    const row = document.createElement('tr');
    appendHistoryCell(row, movement.id);
    appendHistoryCell(row, movement.medicineId);
    appendHistoryCell(row, movement.label);
    appendHistoryCell(row, stockMovementLabel(movement.type));
    appendHistoryCell(row, String(movement.quantity), 'cell-number');
    appendHistoryCell(row, movement.dateIso);
    appendHistoryCell(row, movement.actorUid ?? UNKNOWN_LABEL);
    appendHistoryCell(row, movement.orderId ?? UNKNOWN_LABEL);
    appendHistoryCell(row, movement.requestId ?? UNKNOWN_LABEL);
    rows.append(row);
  }
}

/** Reads movement rows only for the order selected in the existing details dialog. */
async function loadOrderHistoryMovements(orderId: string): Promise<void> {
  const generation = ++orderHistoryMovementsGeneration;
  const rows = document.getElementById(ELEMENT_IDS.orderHistoryMovementsRows);
  if (rows !== null) {
    rows.textContent = '';
  }
  setOrderHistoryMovementsState('loading', 'جارٍ تحميل حركات هذا الطلب…');
  const api = getDrugManagerApi();
  if (api === null) {
    setOrderHistoryMovementsState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }
  try {
    const result = await api.stockLogs.listByOrder({ orderId });
    if (
      generation !== orderHistoryMovementsGeneration
      || selectedOrderHistory?.id !== orderId
    ) {
      return;
    }
    if (!result.ok) {
      setOrderHistoryMovementsState('error', result.error.message);
      return;
    }
    renderOrderHistoryMovements(result.value);
    setOrderHistoryMovementsState(
      result.value.length === 0 ? 'empty' : 'ready',
      result.value.length === 0 ? 'لا توجد حركات مخزون مسجّلة لهذا الطلب.' : '',
    );
  } catch {
    if (generation === orderHistoryMovementsGeneration) {
      setOrderHistoryMovementsState('error', 'تعذر تحميل حركات هذا الطلب. يُرجى إعادة فتح التفاصيل للمحاولة مرة أخرى.');
    }
  }
}

/** Opens the read-only details dialog for one loaded order. */
function openOrderHistoryDialog(orderId: string): void {
  const order = (loadedOrderHistory ?? []).find((candidate) => candidate.id === orderId);
  if (order === undefined) {
    return;
  }
  selectedOrderHistory = order;
  fillOrderHistoryDialog(order);
  void loadOrderHistoryMovements(order.id);

  const dialog = document.getElementById(ELEMENT_IDS.orderHistoryDialog) as (HTMLElement & {
    showModal?: () => void;
  }) | null;
  if (dialog !== null && typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }
  setHidden(ELEMENT_IDS.orderHistoryDialog, false);
}

/** Closes the details dialog and drops the selection. */
function closeOrderHistoryDialog(): void {
  selectedOrderHistory = null;
  orderHistoryMovementsGeneration += 1;
  const rows = document.getElementById(ELEMENT_IDS.orderHistoryMovementsRows);
  if (rows !== null) {
    rows.textContent = '';
  }
  setOrderHistoryMovementsState('idle', '');
  const dialog = document.getElementById(ELEMENT_IDS.orderHistoryDialog) as (HTMLElement & {
    close?: () => void;
  }) | null;
  if (dialog !== null && typeof dialog.close === 'function') {
    dialog.close();
    return;
  }
  setHidden(ELEMENT_IDS.orderHistoryDialog, true);
}

/**
 * Applies the history status filter locally.
 *
 * An unrecognised value widens the view to "all" instead of being trusted: the
 * `<select>` only offers known values, so anything else is a tampered DOM.
 */
function applyOrderHistoryStatusFilter(value: string): void {
  ordersHistoryStatusFilter = ORDER_HISTORY_FILTER_VALUES.has(value) ? value : 'all';
  renderOrderHistory();
  if (loadedOrderHistory !== null && !ordersHistoryInFlight && !ordersHistoryLoadMoreInFlight) {
    setOrderHistoryDataState();
  }
}

// ===========================================================================
// Stage 13 - the SYSTEM SETTINGS page (READ-ONLY).
//
// THE PAGE HAS NO WRITE PATH, AND NONE IS INTENDED
// The one transport call is `api.settings.get()`, which takes no argument and is
// already wired through channels, preload and handlers. No save operation is
// added, no editable control is rendered, and the markup carries no <form>.
//
// WHAT IS SHOWN AND HOW
// Every value is printed EXACTLY as the read layer returned it. Nothing is
// recomputed, reformatted or invented: no time is re-parsed, no number is
// recalculated, and a missing document is shown as missing rather than filled in.
//
// The two DEAD fields (`maxDailyOrders`, `assistantId`) are displayed with a
// "غير مُفعّل" label on their term, because the mobile model does not currently
// read either of them. A manager looking at this screen should see that the
// values exist AND that they drive nothing today.
// ===========================================================================

/** Renders one `settings/app` value into the page. Editable fields are set as
 * control values; the two dead fields remain plain display text. */
function renderSettings(): void {
  const settings = loadedAppSettings;
  if (settings === null) {
    return;
  }

  // `configured === false` means the document is ABSENT and these are the A2
  // fallbacks the processing step would itself apply. The banner says so in plain
  // words, because a manager who cannot tell stored values from defaults would
  // read the wrong thing into this page.
  setHidden(ELEMENT_IDS.settingsNotConfigured, settings.configured);

  // Editable controls - set their value, not their text content.
  const minDays = document.getElementById(ELEMENT_IDS.settingsMinDays) as HTMLInputElement | null;
  if (minDays !== null) {
    minDays.value = String(settings.minDaysBetweenOrders);
  }
  const friday = document.getElementById(ELEMENT_IDS.settingsFriday) as HTMLSelectElement | null;
  if (friday !== null) {
    friday.value = String(settings.allowFridayOrders);
  }
  const startTime = document.getElementById(ELEMENT_IDS.settingsStartTime) as HTMLInputElement | null;
  if (startTime !== null) {
    startTime.value = settings.startTime;
  }
  const endTime = document.getElementById(ELEMENT_IDS.settingsEndTime) as HTMLInputElement | null;
  if (endTime !== null) {
    endTime.value = settings.endTime;
  }

  // Read-only display values for the two dead fields.
  setText(ELEMENT_IDS.settingsMaxDaily, String(settings.maxDailyOrders));
  setText(ELEMENT_IDS.settingsAssistant, settings.assistantId);
}

/** The Arabic label for a stored boolean. An unexpected value is not invented. */
function booleanLabel(value: boolean): string {
  return BOOLEAN_LABELS[String(value)] ?? UNKNOWN_LABEL;
}

/** Sets the settings page state, keeping the values visible while busy. */
function setSettingsState(state: UsersViewState, message: string): void {
  const region = document.getElementById(ELEMENT_IDS.settingsState);
  region?.setAttribute('data-view-state', state);
  setText(ELEMENT_IDS.settingsStateMessage, message);
  setHidden(ELEMENT_IDS.settingsRetry, state !== 'error');
  const busy = state === 'loading' || state === 'refreshing';
  setDisabled(ELEMENT_IDS.settingsRefresh, busy);
  setDisabled(ELEMENT_IDS.settingsSave, busy || settingsSaveInFlight);
}

/**
 * Reads `settings/app` through the single named, payload-free operation.
 *
 * A THROWN bridge error is handled like a failed envelope: nothing is claimed,
 * and no stale-but-plausible values are left on screen pretending to be current.
 */
async function loadSettings(reason: 'loading' | 'refreshing'): Promise<void> {
  if (settingsInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setSettingsState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  settingsInFlight = true;
  setSettingsState(
    reason,
    reason === 'loading' ? 'جارٍ تحميل الإعدادات…' : 'جارٍ التحديث…',
  );

  let result: ApplicationResult<AppSettingsView>;
  try {
    result = await api.settings.get();
  } catch (error: unknown) {
    settingsInFlight = false;
    setSettingsState('error', 'تعذر تحميل الإعدادات. يُرجى المحاولة مرة أخرى.');
    return;
  }
  settingsInFlight = false;

  if (!result.ok) {
    setSettingsState('error', result.error.message);
    return;
  }

  loadedAppSettings = result.value;
  renderSettings();
  setSettingsState('ready', '');
}

/**
 * Stage N - commits the four editable rule fields back to `settings/app`.
 *
 * Reads the current control values, validates them client-side (the same
 * bounds the application layer enforces), then sends them through
 * `api.settings.save`. The two dead fields are never included: they are
 * preserved by the service layer from the stored document.
 */
async function submitSettingsSave(): Promise<void> {
  if (settingsSaveInFlight) {
    return;
  }
  settingsSaveInFlight = true;
  setDisabled(ELEMENT_IDS.settingsSave, true);
  try {
    const minDaysEl = document.getElementById(ELEMENT_IDS.settingsMinDays);
    const fridayEl = document.getElementById(ELEMENT_IDS.settingsFriday);
    const startEl = document.getElementById(ELEMENT_IDS.settingsStartTime);
    const endEl = document.getElementById(ELEMENT_IDS.settingsEndTime);
    const minDays = minDaysEl ? Number(minDaysEl.value) : '';
    const friday = fridayEl ? fridayEl.checked : false;
    const start = startEl ? startEl.value : '';
    const end = endEl ? endEl.value : '';
    const draft: AppSettingsViewDraft = {
      minDaysBetweenOrders: minDays,
      allowFridayOrders: friday,
      startTime: start,
      endTime: end,
    };
    const result = await drugManager.settings.save(draft);
    if (!result.ok) {
      setErrorMessage(result.error ?? 'Save failed');
      return;
    }
    await loadSettings('saving');
  } catch (e) {
    setErrorMessage(e instanceof Error ? e.message : 'Save failed');
  } finally {
    settingsSaveInFlight = false;
    setDisabled(ELEMENT_IDS.settingsSave, false);
  }
}
async function submitSettingsSave(): Promise<void> {
  if (settingsSaveInFlight) {
    return;
  }
  const api = getDrugManagerApi();
  if (api === null) {
    setSettingsState('error', BRIDGE_UNAVAILABLE_MESSAGE);
    return;
  }

  const minDaysInput = document.getElementById(ELEMENT_IDS.settingsMinDays) as HTMLInputElement | null;
  const fridayInput = document.getElementById(ELEMENT_IDS.settingsFriday) as HTMLSelectElement | null;
  const startTimeInput = document.getElementById(ELEMENT_IDS.settingsStartTime) as HTMLInputElement | null;
  const endTimeInput = document.getElementById(ELEMENT_IDS.settingsEndTime) as HTMLInputElement | null;

  const minDays = Number.parseInt(minDaysInput?.value ?? '', 10);
  const allowFriday = fridayInput?.value === 'true';
  const startTime = startTimeInput?.value ?? '';
  const endTime = endTimeInput?.value ?? '';

  if (!Number.isFinite(minDays) || minDays < 1 || minDays > 365) {
    setSettingsState('error', 'أقل عدد أيام بين الطلبات يجب أن يكون عددًا صحيحًا بين 1 و 365.');
    return;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    setSettingsState('error', 'بداية دوام الطلبات يجب أن تكون بالصيغة HH:mm.');
    return;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
    setSettingsState('error', 'نهاية دوام الطلبات يجب أن تكون بالصيغة HH:mm.');
    return;
  }

  const draft = {
    minDaysBetweenOrders: minDays,
    allowFridayOrders: allowFriday,
    startTime,
    endTime,
  };

  settingsSaveInFlight = true;
  setDisabled(ELEMENT_IDS.settingsSave, true);
  setSettingsState('saving', 'جارٍ حفظ الإعدادات…');

  let result: ApplicationResult<null>;
  try {
    result = await api.settings.save(draft);
  } catch (error: unknown) {
    settingsSaveInFlight = false;
    setDisabled(ELEMENT_IDS.settingsSave, false);
    setSettingsState('error', 'تعذر حفظ الإعدادات. يُرجى المحاولة مرة أخرى.');
    return;
  }
  settingsSaveInFlight = false;

  if (!result.ok) {
    setDisabled(ELEMENT_IDS.settingsSave, false);
    setSettingsState('error', result.error.message);
    return;
  }

  // Refresh from the server so the screen shows what was actually stored.
  settingsInFlight = false;
  await loadSettings('refreshing');
  setDisabled(ELEMENT_IDS.settingsSave, false);
  setSettingsState('ready', 'تم حفظ الإعدادات.');
}
