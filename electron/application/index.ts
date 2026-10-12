/**
 * Stage 7 - the application layer.
 *
 * Renderer UI
 *   -> secure Electron IPC            (electron/ipc/*)
 *      -> Main/Application layer      (this directory)
 *         -> Domain / Repositories
 *            -> Firebase Auth REST / Firestore REST
 *
 * WHAT BELONGS HERE
 * Use cases. Each one names an operation the future UI needs, reads only through
 * a Stage 5B repository contract, and answers with an `ApplicationResult`. The
 * layer is the ONLY place that knows both "what the UI wants" and "what the
 * domain offers".
 *
 * WHAT MUST NEVER APPEAR HERE
 *  - Electron imports. Nothing in this directory may `import ... from 'electron'`,
 *    which is what lets the whole layer be unit tested under plain `node --test`.
 *  - A Firestore implementation. Only `repositories/contracts/` is imported, so
 *    the transport is unreachable from here by construction.
 *  - Firestore wire vocabulary. No `stringValue`, no `updateMask`, no document
 *    path: those belong to the mappers, and a wire value reaching a UI type would
 *    mean the boundary leaked.
 *  - An authorization decision. This layer reports what firestore.rules decided;
 *    it never decides. The one check it does perform is session PRESENCE, which
 *    is a local fact about this process and grants nothing.
 *  - A token. No function here returns or accepts one; the `AuthenticationSession`
 *    port deliberately has no token getter.
 *
 * IMPORT DIRECTION (docs/domain-data-architecture.md §9.2)
 *   ipc/handlers -> application -> services + repositories/contracts -> domain
 * `domain` imports nothing above it, and `repositories/contracts` imports nothing
 * from `services`.
 */

import type { MedicinesRepository, SettingsRepository } from '../repositories/contracts/medicines-repository';
import type { OrderRequestsRepository, OrdersRepository, StockLogsRepository } from '../repositories/contracts/order-repository';
import type { UsersRepository } from '../repositories/contracts/users-repository';
import type { InboundStockTransactionFactory } from '../repositories/contracts/common';
import type { OrderProcessingService } from '../services/order-processing.service';
import { AuthApplicationService, type AuthenticationSession } from './auth.service';
import { InboundStockService } from './inbound-stock.service';
import { MedicinesManagementService } from './medicines-management.service';
import { ManagerApplicationService, type ManagerRepositories } from './manager-data.service';
import { OrderRequestsApplicationService } from './order-requests.service';
import { UsersManagementService } from './users-management.service';

export {
  ApplicationError,
  APPLICATION_ERROR_MESSAGES,
  redactDiagnostic,
  toApplicationError,
  toApplicationErrorPayload,
} from './application-error';
export type { ApplicationErrorKind, ApplicationErrorOptions } from './application-error';

export {
  applicationFailure,
  applicationFailureFrom,
  applicationRefusal,
  applicationSuccess,
  attempt,
  isApplicationFailure,
  isApplicationSuccess,
} from './application-result';

export { AuthApplicationService, requireAuthenticatedUid } from './auth.service';
export type { AuthenticationSession, AuthApplicationServiceOptions, OwnProfileReader } from './auth.service';

export { MANAGER_LIST_LIMITS, ManagerApplicationService } from './manager-data.service';
export type { AuthStateSource, ManagerApplicationServiceOptions, ManagerRepositories } from './manager-data.service';

export { OrderRequestsApplicationService } from './order-requests.service';
export type { OrderRequestsApplicationServiceOptions } from './order-requests.service';

export { UsersManagementService } from './users-management.service';
export type { UsersManagementServiceOptions } from './users-management.service';

export { MedicinesManagementService } from './medicines-management.service';
export type { MedicinesManagementServiceOptions } from './medicines-management.service';
export { InboundStockService } from './inbound-stock.service';
export type {
  InboundStockReceiptView,
  InboundStockServiceOptions,
  ValidatedInboundStock,
} from './inbound-stock.service';

export {
  toAppSettingsView,
  toMedicineListItemView,
  toOrderHistoryItemView,
  toOrderProcessingOutcomeView,
  toOrderRequestListItemView,
  toUserListItemView,
} from './views';

/** The three use-case groups the IPC layer is allowed to call. */
export interface ManagerApplication {
  readonly auth: AuthApplicationService;
  readonly manager: ManagerApplicationService;
  readonly orderRequests: OrderRequestsApplicationService;
  /** Stage 9: the user WRITE path. Reads stay on `manager.listUsers()`. */
  readonly usersManagement: UsersManagementService;
  /** Stage 10: the medicine WRITE path. Reads stay on `manager.listMedicines()`. */
  readonly medicinesManagement: MedicinesManagementService;
  /**
   * Stage 15: the INBOUND STOCK RECEIPT path.
   *
   * Kept separate from `medicinesManagement` even though both touch `medicines`,
   * because they have nothing else in common: `setMaxQuantity` edits a cap and
   * writes no audit row, while `receiveInboundStock` moves real stock and cannot
   * exist without one. Merging them would make "which medicine writes are safe"
   * a question about a single class instead of two clearly separated ones.
   */
  readonly inboundStock: InboundStockService;
}

export interface ManagerApplicationDependencies {
  /** The Stage 2 session owner. Holds every token, in Main-process memory. */
  readonly session: AuthenticationSession;
  readonly usersRepository: UsersRepository;
  readonly medicinesRepository: MedicinesRepository;
  readonly settingsRepository: SettingsRepository;
  readonly orderRequestsRepository: OrderRequestsRepository;
  /**
   * Stage 12: the READ-ONLY orders repository behind the history/audit screen.
   *
   * REQUIRED, not optional, exactly like `orderRequestsRepository`. Making it
   * optional would need a stand-in for the missing case, and that stand-in would
   * be worse than the mistake it hides: `main.ts` would build cleanly, the app
   * would start, and the audit screen would answer `INFRASTRUCTURE_FAILURE`
   * forever - a silent production fault instead of a build-time one.
   */
  readonly ordersRepository: OrdersRepository;
  /**
   * Stage 14: the READ-ONLY stock movement audit repository.
   *
   * REQUIRED, exactly like `ordersRepository`. Making it optional would need a
   * stand-in for the missing case, and that stand-in would hide a real mistake:
   * `main.ts` would build, the app would start, and the inventory audit screen
   * would answer `INFRASTRUCTURE_FAILURE` forever.
   */
  readonly stockLogsRepository: StockLogsRepository;
  /**
   * Stage 15: the factory that begins ONE inbound-stock transaction per attempt.
   *
   * A factory rather than a ready-made transaction, because a retried receipt must
   * re-read the medicine inside a FRESH transaction - reusing a begun handle would
   * compute the absolute stock from a stale read, which is exactly the bug a
   * transaction exists to prevent.
   */
  readonly inboundStockTransactionFactory: InboundStockTransactionFactory;
  /** The Stage 6 orchestrator. Never re-implemented here. */
  readonly orderProcessing: OrderProcessingService;
  /** Diagnostics sink for the Main-process log. */
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}

/**
 * Wires the three use-case groups together.
 *
 * The composition root lives here so `main.ts` stays a wiring file, and so the
 * whole application layer can be built in a test with fake repositories. Note
 * that `FirestoreAuthService` is passed as the `AuthenticationSession` port and
 * `FirestoreUsersRepository` doubles as the `OwnProfileReader`: both satisfy
 * their ports structurally, so no adapter class is needed.
 */
export function createManagerApplication(dependencies: ManagerApplicationDependencies): ManagerApplication {
  const repositories: ManagerRepositories = {
    users: dependencies.usersRepository,
    medicines: dependencies.medicinesRepository,
    settings: dependencies.settingsRepository,
    orderRequests: dependencies.orderRequestsRepository,
    orders: dependencies.ordersRepository,
    /**
     * Stage 14: the audit read. Handing `manager` the whole repository (not a
     * narrowed adapter) is deliberate - it lets the type system prove the screen
     * reaches only what `StockLogsRepository` exposes, which is two list methods
     * and no write.
     */
    stockLogs: dependencies.stockLogsRepository,
  };

  const auth = new AuthApplicationService({
    session: dependencies.session,
    profiles: dependencies.usersRepository,
    onDiagnostic: dependencies.onDiagnostic,
  });

  return Object.freeze({
    auth,
    manager: new ManagerApplicationService({
      repositories,
      auth,
      onDiagnostic: dependencies.onDiagnostic,
    }),
    orderRequests: new OrderRequestsApplicationService({
      orderProcessing: dependencies.orderProcessing,
      // Stage 16 resolves item names from the same trusted catalogue as the rest
      // of the application before the existing submission repository is called.
      medicines: dependencies.medicinesRepository,
      // Stage 11: the same read contract Stage 6 uses, so a detail re-read can
      // never observe a different document than the processing transaction did.
      orderRequests: dependencies.orderRequestsRepository,
      auth,
      onDiagnostic: dependencies.onDiagnostic,
    }),
    usersManagement: new UsersManagementService({
      users: dependencies.usersRepository,
      auth,
      onDiagnostic: dependencies.onDiagnostic,
    }),
    medicinesManagement: new MedicinesManagementService({
      medicines: dependencies.medicinesRepository,
      auth,
      onDiagnostic: dependencies.onDiagnostic,
    }),
    // Stage 15: the receipt path, given only a factory and the session. It has no
    // repository at all - every read and every write it performs happens inside one
    // transaction object, which is what makes "stock and its log move together" a
    // structural property rather than a convention.
    inboundStock: new InboundStockService({
      createTransaction: dependencies.inboundStockTransactionFactory,
      auth,
      onDiagnostic: dependencies.onDiagnostic,
    }),
  });
}
