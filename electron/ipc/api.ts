/**
 * The renderer-facing API.
 *
 * This module is intentionally Electron-free: it only needs an `invoke`
 * function, which makes the IPC contract fully unit testable without starting
 * Electron. Every exposed function maps to exactly one IPC channel.
 *
 * Stage 7 rules this factory enforces:
 *  - ONE `invoke` CALL SITE PER OPERATION. The channel is a compile-time
 *    constant, never a parameter, so no caller can redirect an operation to a
 *    different channel. There is no generic `invoke` exposed anywhere.
 *  - NO TOKEN PASSED IN EITHER DIRECTION. Sign-in sends credentials and receives
 *    a `SafeAuthState`; nothing here ever returns or accepts a token.
 *  - NO RAW DATA ACCESS. No operation takes a collection, a document path, a
 *    field mask or a write payload. `orders.process` takes one request id.
 *  - EVERY DATA OPERATION ANSWERS WITH `ApplicationResult`, so a caller cannot
 *    be surprised by a rejected `invoke` carrying an internal message.
 */

import { IPC_CHANNELS } from './channels';

/** Version of the renderer-facing API surface. Must be bumped when the contract changes. */
export const DRUG_MANAGER_API_VERSION = '0.3.0';

/** Minimal shape of `ipcRenderer.invoke`. */
export type InvokeFunction = (channel: string, ...args: readonly unknown[]) => Promise<unknown>;

/**
 * Builds the frozen, minimal API object that the preload script exposes to the
 * renderer. No Node.js object, no path, no file handle, no tokens and no database client is
 * ever handed across the bridge.
 *
 * The whole tree is deep-frozen, not just the root: a renderer that could
 * reassign `api.users.list` would be able to swap an operation for its own
 * function, and a later call elsewhere in the UI would silently trust it.
 */
export function createDrugManagerApi(invoke: InvokeFunction): DrugManagerApi {
  const api: DrugManagerApi = {
    apiVersion: DRUG_MANAGER_API_VERSION,
    getAppStatus: async (): Promise<AppStatusPayload> => {
      const response = await invoke(IPC_CHANNELS.appStatus);
      return response as AppStatusPayload;
    },
    auth: {
      signIn: async (credentials: SignInCredentials): Promise<SignInResult> => {
        const response = await invoke(IPC_CHANNELS.authSignIn, credentials);
        return response as SignInResult;
      },
      signOut: async (): Promise<void> => {
        await invoke(IPC_CHANNELS.authSignOut);
      },
      getState: async (): Promise<SafeAuthState> => {
        const response = await invoke(IPC_CHANNELS.authGetState);
        return response as SafeAuthState;
      },
    },
    users: {
      list: async (): Promise<ApplicationResult<readonly UserListItemView[]>> => {
        const response = await invoke(IPC_CHANNELS.usersList);
        return response as ApplicationResult<readonly UserListItemView[]>;
      },
      // Stage 9. The payload is the narrow `UpdateUserInput`, never a `User`:
      // there is no parameter through which the renderer could send a document,
      // a field mask or a field the repository refuses to write.
      update: async (input: UpdateUserInput): Promise<ApplicationResult<null>> => {
        const response = await invoke(IPC_CHANNELS.usersUpdate, input);
        return response as ApplicationResult<null>;
      },
    },
    medicines: {
      list: async (): Promise<ApplicationResult<readonly MedicineListItemView[]>> => {
        const response = await invoke(IPC_CHANNELS.medicinesList);
        return response as ApplicationResult<readonly MedicineListItemView[]>;
      },
      // Stage 10. The payload is `{medicineId, maxQuantity}` - there is no
      // parameter through which the renderer could send stock, a counter, a
      // document or a mask.
      updateMaxQuantity: async (input: UpdateMedicineInput): Promise<ApplicationResult<null>> => {
        const response = await invoke(IPC_CHANNELS.medicinesUpdateMaxQuantity, input);
        return response as ApplicationResult<null>;
      },
      // Stage 15: the inbound receipt. The renderer names a medicine and a positive
      // count, and nothing else - no counter, no direction, no mask, no actor. The
      // audit row is written in Main, inside the same transaction, so there is no
      // second call that could be forgotten.
      addInboundStock: async (input: AddInboundStockInput): Promise<ApplicationResult<InboundStockReceiptView>> => {
        const response = await invoke(IPC_CHANNELS.medicinesAddInboundStock, input);
        return response as ApplicationResult<InboundStockReceiptView>;
      },
    },
    orderRequests: {
      list: async (): Promise<ApplicationResult<readonly OrderRequestListItemView[]>> => {
        const response = await invoke(IPC_CHANNELS.orderRequestsList);
        return response as ApplicationResult<readonly OrderRequestListItemView[]>;
      },
      // Stage 11. Takes ONE id and returns ONE request; there is no parameter
      // through which the renderer could name a collection, a field path or a mask.
      get: async (input: GetOrderRequestInput): Promise<ApplicationResult<OrderRequestListItemView>> => {
        const response = await invoke(IPC_CHANNELS.orderRequestsGet, input);
        return response as ApplicationResult<OrderRequestListItemView>;
      },
      // Stage 16: only medicine ids and quantities cross IPC; identity and stored
      // request metadata are owned by Main and the existing repository.
      submit: async (input: SubmitOrderRequestInput): Promise<ApplicationResult<OrderRequestSubmissionView>> => {
        const response = await invoke(IPC_CHANNELS.orderRequestsSubmit, input);
        return response as ApplicationResult<OrderRequestSubmissionView>;
      },
    },
    settings: {
      get: async (): Promise<ApplicationResult<AppSettingsView>> => {
        const response = await invoke(IPC_CHANNELS.settingsGet);
        return response as ApplicationResult<AppSettingsView>;
      },
    },
    // Stage 14: the READ-ONLY inventory movement audit trail.
    //
    // Takes NO payload and offers NO write verb. `quantity` is a positive
    // magnitude in both directions and `type` carries the sign, so nothing here
    // pre-sums it: a balance computed here would be a number Firestore never held.
    stockLogs: {
      list: async (): Promise<ApplicationResult<readonly StockLogView[]>> => {
        const response = await invoke(IPC_CHANNELS.stockLogsList);
        return response as ApplicationResult<readonly StockLogView[]>;
      },
      listByOrder: async (input: GetStockLogsByOrderInput): Promise<ApplicationResult<readonly StockLogView[]>> => {
        const response = await invoke(IPC_CHANNELS.stockLogsListByOrder, input);
        return response as ApplicationResult<readonly StockLogView[]>;
      },
    },
    orders: {
      // Stage 12/23: READ-ONLY. Starts a fresh bounded page without accepting a
      // filter, limit, path or Firestore continuation token from the renderer.
      list: async (): Promise<ApplicationResult<OrderHistoryPageView>> => {
        const response = await invoke(IPC_CHANNELS.ordersList);
        return response as ApplicationResult<OrderHistoryPageView>;
      },
      loadMore: async (): Promise<ApplicationResult<OrderHistoryPageView>> => {
        const response = await invoke(IPC_CHANNELS.ordersHistoryLoadMore);
        return response as ApplicationResult<OrderHistoryPageView>;
      },
      // Stage 17: a separate payload-free owner-scoped read. Main supplies the
      // authenticated UID; this operation cannot request another user's orders.
      myHistory: async (): Promise<ApplicationResult<readonly PersonalOrderHistoryItemView[]>> => {
        const response = await invoke(IPC_CHANNELS.ordersMyHistory);
        return response as ApplicationResult<readonly PersonalOrderHistoryItemView[]>;
      },
      process: async (input: ProcessOrderRequestInput): Promise<ApplicationResult<OrderProcessingOutcomeView>> => {
        const response = await invoke(IPC_CHANNELS.ordersProcess, input);
        return response as ApplicationResult<OrderProcessingOutcomeView>;
      },
    },
  };

  return deepFreeze(api);
}

/** Recursively freezes a plain object tree. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}