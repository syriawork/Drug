/**
 * Stage 7 - the IPC handler layer.
 *
 * A handler's entire job is: take the renderer's argument, hand it to an
 * APPLICATION SERVICE, and return the service's result. That is all. The rule
 * this file exists to enforce is:
 *
 *   HANDLERS CALL APPLICATION SERVICES, NEVER REPOSITORIES.
 *
 * A handler that reached for `UsersRepository` directly would be able to skip the
 * session check, the safe projection and the error classification, and the
 * security property would hold only as long as nobody wrote that handler. Here
 * the dependency simply is not in scope: this module imports `ManagerApplication`
 * and nothing else from the domain or the repositories.
 *
 * WHY THE HANDLERS ARE BUILT BY A FACTORY
 * `createIpcHandlers` returns a plain `Record<channel, handler>` and takes no
 * `ipcMain`. That makes the whole boundary testable under `node --test` with
 * fake services, so "the handler calls the service" and "the handler never
 * throws" are assertions rather than hopes. `main.ts` only performs the
 * `ipcMain.handle` wiring.
 *
 * WHY A HANDLER CANNOT THROW
 * Every listener is wrapped, so a rejected `invoke` - which Electron would
 * populate from the Error's own enumerable properties - is impossible by
 * construction. An unexpected throw is classified into the Stage 7 taxonomy and
 * returned as a value, with the technical detail going to the Main-process log
 * and nothing but a code and a fixed sentence going to the renderer.
 *
 * RENDERER INPUT IS TREATED AS HOSTILE
 * Arguments arrive typed as `unknown` and are validated before use. The one
 * that reaches a domain object is `requestId`, which the application service
 * pattern-checks before any I/O.
 */
import type { ManagerApplication } from '../../application';
import { applicationFailureFrom } from '../../application';
import { IPC_CHANNELS } from '../channels';

/** The shape of an `ipcMain.handle` listener, with the event untyped on purpose. */
export type IpcHandler = (event: unknown, payload: unknown) => unknown;

/** One entry per registered channel, keyed by channel name. */
export type IpcHandlerMap = Readonly<Record<string, IpcHandler>>;

export interface CreateIpcHandlersOptions {
  readonly application: ManagerApplication;
  /** Main-process log sink. Receives diagnostics only, never renderer data. */
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}

/**
 * Builds the complete handler map.
 *
 * Returning a map rather than registering directly means the channel-to-handler
 * correspondence is a value a test can enumerate, which is how "no channel is
 * missing" and "no extra channel exists" are actually checked.
 */
export function createIpcHandlers(options: CreateIpcHandlersOptions): IpcHandlerMap {
  const { application } = options;
  const onDiagnostic = options.onDiagnostic;

  /**
   * Wraps a listener so it can never reject across the bridge.
   *
   * The payload arrives as `unknown` and is passed straight through: each
   * operation decides what shape it accepts, which keeps validation in the
   * application layer where it can be unit tested without Electron.
   */
  const guard = <T>(operation: (payload: unknown) => Promise<ApplicationResult<T>>): IpcHandler => {
    return async (_event: unknown, payload: unknown): Promise<ApplicationResult<T>> => {
      try {
        return await operation(payload);
      } catch (error: unknown) {
        return applicationFailureFrom<T>(error, onDiagnostic);
      }
    };
  };

  return Object.freeze({
    [IPC_CHANNELS.usersList]: guard(async () => application.manager.listUsers()),
    [IPC_CHANNELS.usersUpdate]: guard(async (payload: unknown) => {
      // The handler forwards the payload UNCHANGED and does no validation of its
      // own. Shape checking lives in the application service, where it can be unit
      // tested without Electron, and duplicating it here would create two places
      // that could disagree about what is permitted.
      return application.usersManagement.updateUser(payload);
    }),
    [IPC_CHANNELS.medicinesList]: guard(async () => application.manager.listMedicines()),
    [IPC_CHANNELS.medicinesUpdateMaxQuantity]: guard(async (payload: unknown) => {
      // The handler forwards the payload UNCHANGED and validates nothing itself.
      // Shape checking lives in the application service, where it can be unit
      // tested without Electron, and duplicating it here would create two places
      // that could disagree about what is permitted.
      return application.medicinesManagement.setMaxQuantity(payload);
    }),
    // Stage 15: the INBOUND STOCK RECEIPT.
    //
    // The payload is forwarded WHOLE, never unwrapped, exactly as the two medicine
    // handlers above do. The application layer validates it against an allowlist of
    // exactly two keys, so a `stock`, a `totalInward` or a `uid` smuggled in here is
    // REFUSED rather than silently dropped - which is the whole point of passing
    // the object through instead of picking fields out of it.
    [IPC_CHANNELS.medicinesAddInboundStock]: guard(async (payload: unknown) => {
      return application.inboundStock.receiveInboundStock(payload);
    }),
    [IPC_CHANNELS.orderRequestsList]: guard(async () => application.manager.listOrderRequests()),
    // Stage 11: a single named READ, used to re-read one request after a
    // processing attempt. Like `ordersProcess` it forwards an id only - the
    // handler unwraps it and the application service pattern-checks it, so a
    // document, a collection or a field mask can never be addressed.
    [IPC_CHANNELS.orderRequestsGet]: guard(async (payload: unknown) => {
      return application.orderRequests.getOrderRequest(readRequestId(payload));
    }),
    [IPC_CHANNELS.orderRequestsSubmit]: guard(async (payload: unknown) => {
      return application.orderRequests.submitPendingRequest(payload);
    }),
    [IPC_CHANNELS.settingsGet]: guard(async () => application.manager.getSettings()),
    // Stage N: the settings SAVE. The renderer sends the four editable fields
    // only; the application layer validates, preserves the dead fields, and
    // writes the full `AppSettings` through the repository contract.
    [IPC_CHANNELS.settingsSave]: guard(async (payload: unknown) => {
      return application.manager.saveSettings(payload);
    }),
    [IPC_CHANNELS.ordersList]: guard(async () => application.manager.listOrderHistoryPage()),
    [IPC_CHANNELS.ordersHistoryLoadMore]: guard(async () => application.manager.loadMoreOrderHistory()),
    [IPC_CHANNELS.ordersMyHistory]: guard(async () => application.manager.listMyOrders()),
    // Stage 14: the READ-ONLY stock movement audit trail.
    //
    // The payload is IGNORED, exactly as for `ordersList`. There is no parameter
    // through which the renderer could aim this at one medicine, one order or one
    // period, so what comes back is precisely the window firestore.rules permits.
    [IPC_CHANNELS.stockLogsList]: guard(async () => application.manager.listStockMovements()),
    // Stage 19: forward only the named order-id payload; the application layer
    // validates it and supplies the fixed query bound.
    [IPC_CHANNELS.stockLogsListByOrder]: guard(async (payload: unknown) => {
      return application.manager.listStockMovementsByOrder(payload);
    }),
    // Stage 12: the READ-ONLY orders history.
    //
    // The payload is IGNORED, not validated and not forwarded. `guard` accepts
    // `unknown` because the channel takes no input at all, so a renderer cannot
    // pass an id, a collection, a filter or a page size - there is no parameter
    // through which to narrow or widen what firestore.rules decides it may read.
    [IPC_CHANNELS.ordersProcess]: guard(async (payload: unknown) => {
      // The renderer may only NAME a request. The id is unwrapped here and
      // validated by the application service, which refuses anything that is not
      // a plain id string BEFORE it reaches the transport.
      return application.orderRequests.processOrderRequest(readRequestId(payload));
    }),
  });
}

/**
 * Reads `requestId` out of the renderer payload without trusting its shape.
 *
 * Returning `null` for anything unrecognised is what makes the handler total: a
 * malformed payload reaches the application service as an invalid id and is
 * refused as `VALIDATION_FAILED`, rather than throwing here.
 */
export function readRequestId(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const candidate = payload as Record<string, unknown>;
  return candidate['requestId'] ?? null;
}
