/**
 * IPC channel names shared by the main process and the preload bridge.
 * The renderer never sees these strings: it only calls the typed preload API.
 *
 * Stage 7 naming convention: `<app>:<area>:<verb>`. Every name describes a
 * NAMED APPLICATION OPERATION, never a transport primitive - there is
 * deliberately no `query`, `get-document`, `commit` or `invoke` channel, because
 * a channel that mirrors a Firestore REST verb would be a channel the renderer
 * could aim at a document.
 */
export const IPC_CHANNELS = {
  appStatus: 'drug-manager:app-status',
  authSignIn: 'drug-manager:auth:sign-in',
  authSignOut: 'drug-manager:auth:sign-out',
  authGetState: 'drug-manager:auth:get-state',
  usersList: 'drug-manager:users:list',
  usersUpdate: 'drug-manager:users:update',
  medicinesList: 'drug-manager:medicines:list',
  medicinesUpdateMaxQuantity: 'drug-manager:medicines:update-max-quantity',
  orderRequestsList: 'drug-manager:order-requests:list',
  orderRequestsGet: 'drug-manager:order-requests:get',
  // Stage 16: submit employee intent only; the Main process supplies identity,
  // catalogue snapshots and repository-owned request metadata.
  orderRequestsSubmit: 'drug-manager:order-requests:submit',
  settingsGet: 'drug-manager:settings:get',
  ordersProcess: 'drug-manager:orders:process',
  // Stage 12: the READ-ONLY history/audit read.
  //
  // It sits beside `ordersProcess` on purpose: the two are opposite halves of the
  // same collection and a reader seeing only one would assume the other does not
  // exist. The read takes NO payload at all - there is no id, no filter and no
  // paging argument, so the renderer cannot aim it at anything narrower or wider
  // than the whole (rules-permitted) history.
  ordersList: 'drug-manager:orders:list',
  // Stage 23: continue the Main-owned cursor. The renderer supplies no token,
  // path, filter or page size; Firestore Rules still decide whether the read is allowed.
  ordersHistoryLoadMore: 'drug-manager:orders:history-load-more',
  // Stage 17: the caller supplies no identity or list bound; Main scopes the
  // owner query to its authenticated session.
  ordersMyHistory: 'drug-manager:orders:my-history',
  // Stage 14: the READ-ONLY stock movement audit trail.
  //
  // It sits beside `ordersList` on purpose: an order is what CAUSED the movements
  // and a manager reading the history needs to see what it did to the inventory.
  // Like `ordersList` it takes NO payload at all, so the renderer cannot point it
  // at one medicine, one order or one date range - and there is no write verb in
  // this namespace to point anywhere in the first place.
  stockLogsList: 'drug-manager:stock-logs:list',
  // Stage 19: read the bounded movement window for one selected order.
  stockLogsListByOrder: 'drug-manager:stock-logs:list-by-order',
  // Stage 15: the INBOUND STOCK RECEIPT - the first inventory WRITE Windows has.
  //
  // It takes EXACTLY `{medicineId, quantity}` and nothing else, and the application
  // layer refuses any other key before a transaction is begun. The renderer cannot
  // name a file mask, a counter, a direction or a document body, so the only thing
  // it can express is "goods of this many arrived for this medicine" - and the
  // Main process decides what that means in storage.
  //
  // The companion `stock_logs` row is NOT a separate channel: it is written inside
  // the same transaction, so a renderer could not ask for a receipt without its
  // audit trail even if it wanted to.
  medicinesAddInboundStock: 'drug-manager:medicines:add-inbound-stock',
} as const;

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Returns every registered channel name (used by tests to keep the surface small). */
export function listIpcChannelNames(): readonly string[] {
  return Object.values(IPC_CHANNELS);
}