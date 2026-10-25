import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge - the ONLY boundary between the renderer and the main process.
 *
 * Security notes:
 *  - contextIsolation is ON (see electron/window/security.ts)
 *  - nodeIntegration is OFF, therefore the renderer has no require/process/fs
 *  - sandboxed: bundled standalone so no require('./ipc/api') fails in sandbox
 *  - only the frozen, minimal, typed API below is exposed
 *  - no Firestore client, no Firebase credential, no tokens and no network helper is exposed
 *
 * Stage 7 - what this file is allowed to hand over, and what it is not:
 *  - `ipcRenderer` ITSELF is never exposed. The renderer cannot reach it, cannot
 *    name a channel, and cannot send on one. Every call below targets a channel
 *    constant written here, at load time, with no argument that could redirect it.
 *  - There is no generic `invoke`, no `send`, no `on`, and no `once`. Adding any
 *    of them would hand the renderer a way to reach a handler that is not on the
 *    typed contract.
 *  - `ipcMain`-side handlers are registered per named channel; a channel the
 *    renderer does not know cannot be reached through this object at all.
 *  - The exposed tree is deep-frozen, so a compromised renderer cannot replace an
 *    operation with its own function and have another part of the UI trust it.
 *  - No Node.js API, no filesystem API, no process API and no Firebase API
 *    crosses this line in either direction.
 *
 * The API version and the channel names are duplicated from
 * `electron/ipc/api.ts` and `electron/ipc/channels.ts` because a sandboxed
 * preload cannot `require` them; `tests/stage7/ipc-boundary.test.ts` asserts
 * the copies cannot drift apart.
 */

const DRUG_MANAGER_API_VERSION = '0.3.0';
const APP_STATUS_CHANNEL = 'drug-manager:app-status';
const AUTH_SIGN_IN_CHANNEL = 'drug-manager:auth:sign-in';
const AUTH_SIGN_OUT_CHANNEL = 'drug-manager:auth:sign-out';
const AUTH_GET_STATE_CHANNEL = 'drug-manager:auth:get-state';
const USERS_LIST_CHANNEL = 'drug-manager:users:list';
const USERS_UPDATE_CHANNEL = 'drug-manager:users:update';
const MEDICINES_LIST_CHANNEL = 'drug-manager:medicines:list';
const MEDICINES_UPDATE_MAX_QUANTITY_CHANNEL = 'drug-manager:medicines:update-max-quantity';
const ORDER_REQUESTS_LIST_CHANNEL = 'drug-manager:order-requests:list';
const ORDER_REQUESTS_GET_CHANNEL = 'drug-manager:order-requests:get';
const ORDER_REQUESTS_SUBMIT_CHANNEL = 'drug-manager:order-requests:submit';
const SETTINGS_GET_CHANNEL = 'drug-manager:settings:get';
const SETTINGS_SAVE_CHANNEL = 'drug-manager:settings:save';
const ORDERS_PROCESS_CHANNEL = 'drug-manager:orders:process';
const ORDERS_LIST_CHANNEL = 'drug-manager:orders:list';
const ORDERS_HISTORY_LOAD_MORE_CHANNEL = 'drug-manager:orders:history-load-more';
const ORDERS_MY_HISTORY_CHANNEL = 'drug-manager:orders:my-history';
const STOCK_LOGS_LIST_CHANNEL = 'drug-manager:stock-logs:list';
const STOCK_LOGS_LIST_BY_ORDER_CHANNEL = 'drug-manager:stock-logs:list-by-order';
const MEDICINES_ADD_INBOUND_STOCK_CHANNEL = 'drug-manager:medicines:add-inbound-stock';

const drugManagerApi: DrugManagerApi = deepFreeze({
  apiVersion: DRUG_MANAGER_API_VERSION,
  getAppStatus: async (): Promise<AppStatusPayload> => {
    const response = await ipcRenderer.invoke(APP_STATUS_CHANNEL);
    return response as AppStatusPayload;
  },
  auth: {
    signIn: async (credentials: SignInCredentials): Promise<SignInResult> => {
      const response = await ipcRenderer.invoke(AUTH_SIGN_IN_CHANNEL, credentials);
      return response as SignInResult;
    },
    signOut: async (): Promise<void> => {
      await ipcRenderer.invoke(AUTH_SIGN_OUT_CHANNEL);
    },
    getState: async (): Promise<SafeAuthState> => {
      const response = await ipcRenderer.invoke(AUTH_GET_STATE_CHANNEL);
      return response as SafeAuthState;
    },
  },
  users: {
    list: async (): Promise<ApplicationResult<readonly UserListItemView[]>> => {
      const response = await ipcRenderer.invoke(USERS_LIST_CHANNEL);
      return response as ApplicationResult<readonly UserListItemView[]>;
    },
    // Stage 9. The renderer supplies a uid and at most three named transitions.
    // It cannot express a document, a mask, a collection, or a field such as
    // `role` that the repository contract deliberately refuses to write.
    update: async (input: UpdateUserInput): Promise<ApplicationResult<null>> => {
      const response = await ipcRenderer.invoke(USERS_UPDATE_CHANNEL, input);
      return response as ApplicationResult<null>;
    },
  },
  medicines: {
    list: async (): Promise<ApplicationResult<readonly MedicineListItemView[]>> => {
      const response = await ipcRenderer.invoke(MEDICINES_LIST_CHANNEL);
      return response as ApplicationResult<readonly MedicineListItemView[]>;
    },
    // Stage 10. The renderer supplies a medicine id and a whole number, and
    // nothing else. It cannot express a stock movement, a counter, a document
    // or a field mask.
    updateMaxQuantity: async (input: UpdateMedicineInput): Promise<ApplicationResult<null>> => {
      const response = await ipcRenderer.invoke(MEDICINES_UPDATE_MAX_QUANTITY_CHANNEL, input);
      return response as ApplicationResult<null>;
    },
    // Stage 15: the inbound receipt. It takes ONE medicine id and ONE positive
    // quantity and nothing else: no counter, no direction, no field mask, no actor.
    // The `stock_logs` row is written inside the same transaction in Main, so a
    // stock movement cannot be filed without its audit trail.
    addInboundStock: async (input: AddInboundStockInput): Promise<ApplicationResult<InboundStockReceiptView>> => {
      const response = await ipcRenderer.invoke(MEDICINES_ADD_INBOUND_STOCK_CHANNEL, input);
      return response as ApplicationResult<InboundStockReceiptView>;
    },
  },
  orderRequests: {
    list: async (): Promise<ApplicationResult<readonly OrderRequestListItemView[]>> => {
      const response = await ipcRenderer.invoke(ORDER_REQUESTS_LIST_CHANNEL);
      return response as ApplicationResult<readonly OrderRequestListItemView[]>;
    },
    // Stage 11. The renderer supplies ONE request id and nothing else.
    get: async (input: GetOrderRequestInput): Promise<ApplicationResult<OrderRequestListItemView>> => {
      const response = await ipcRenderer.invoke(ORDER_REQUESTS_GET_CHANNEL, input);
      return response as ApplicationResult<OrderRequestListItemView>;
    },
    // Stage 16: the renderer supplies only medicine ids and quantities.
    submit: async (input: SubmitOrderRequestInput): Promise<ApplicationResult<OrderRequestSubmissionView>> => {
      const response = await ipcRenderer.invoke(ORDER_REQUESTS_SUBMIT_CHANNEL, input);
      return response as ApplicationResult<OrderRequestSubmissionView>;
    },
  },
  settings: {
    get: async (): Promise<ApplicationResult<AppSettingsView>> => {
      const response = await ipcRenderer.invoke(SETTINGS_GET_CHANNEL);
      return response as ApplicationResult<AppSettingsView>;
    },
    // Stage N: saves the four editable rule fields back to `settings/app`.
    save: async (input: AppSettingsViewDraft): Promise<ApplicationResult<null>> => {
      const response = await ipcRenderer.invoke(SETTINGS_SAVE_CHANNEL, input);
      return response as ApplicationResult<null>;
    },
  },
  // Stage 14: the READ-ONLY inventory movement audit trail. It takes NO argument
  // and this namespace has no write verb at all, so a stock movement cannot be
  // written from the renderer even in principle.
  stockLogs: {
    list: async (): Promise<ApplicationResult<readonly StockLogView[]>> => {
      const response = await ipcRenderer.invoke(STOCK_LOGS_LIST_CHANNEL);
      return response as ApplicationResult<readonly StockLogView[]>;
    },
    listByOrder: async (input: GetStockLogsByOrderInput): Promise<ApplicationResult<readonly StockLogView[]>> => {
      const response = await ipcRenderer.invoke(STOCK_LOGS_LIST_BY_ORDER_CHANNEL, input);
      return response as ApplicationResult<readonly StockLogView[]>;
    },
  },
  orders: {
    // Stage 12/23: READ-ONLY. Both operations take no arguments; Main owns the
    // page cursor and applies the fixed page size.
    list: async (): Promise<ApplicationResult<OrderHistoryPageView>> => {
      const response = await ipcRenderer.invoke(ORDERS_LIST_CHANNEL);
      return response as ApplicationResult<OrderHistoryPageView>;
    },
    loadMore: async (): Promise<ApplicationResult<OrderHistoryPageView>> => {
      const response = await ipcRenderer.invoke(ORDERS_HISTORY_LOAD_MORE_CHANNEL);
      return response as ApplicationResult<OrderHistoryPageView>;
    },
    // Stage 17: payload-free and scoped to the authenticated Main-process user.
    myHistory: async (): Promise<ApplicationResult<readonly PersonalOrderHistoryItemView[]>> => {
      const response = await ipcRenderer.invoke(ORDERS_MY_HISTORY_CHANNEL);
      return response as ApplicationResult<readonly PersonalOrderHistoryItemView[]>;
    },
    // The renderer supplies ONE request id and nothing else: no document, no
    // field mask, no collection, no actor. Everything else is decided in Main.
    process: async (input: ProcessOrderRequestInput): Promise<ApplicationResult<OrderProcessingOutcomeView>> => {
      const response = await ipcRenderer.invoke(ORDERS_PROCESS_CHANNEL, input);
      return response as ApplicationResult<OrderProcessingOutcomeView>;
    },
  },
});

/** Recursively freezes a plain object tree before it crosses the bridge. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

contextBridge.exposeInMainWorld('drugManager', drugManagerApi);