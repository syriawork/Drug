/**
 * Shared builders for the Stage 9 suites.
 *
 * These live here rather than in a test file because `users-ipc.test.ts` needs
 * them too: importing a `.test.ts` would execute its suites a second time, which
 * both doubles the reported count and hides which file a failure came from.
 */

import { createManagerApplication } from '../../electron/application';
import {
  FakeMedicinesRepository,
  FakeOrderProcessingService,
  FakeOrderRequestsRepository,
  FakeOrdersRepository,
  FakeStockLogsRepository,
  FakeInboundStockTransaction,
  FakeSession,
  FakeSettingsRepository,
  FakeUsersRepository,
  makeUser,
} from '../stage7/helpers/fakes';

/**
 * Builds the whole application layer over fakes.
 *
 * The session is already signed in as an admin, so a test can reach the
 * operations without first driving the login flow. `medicines` is injectable
 * too because Stage 10 asserts on the medicine write.
 *
 * `orders` is injectable for Stage 12, which asserts on the read-only orders
 * path. It is ALWAYS supplied - the composition root requires it, and a default
 * here would hide a caller that forgot to wire it.
 */
export function buildApplication(
  users?: FakeUsersRepository,
  medicines?: FakeMedicinesRepository,
  orderRequests?: FakeOrderRequestsRepository,
  orders?: FakeOrdersRepository,
  session?: FakeSession,
): ReturnType<typeof createManagerApplication> {
  return createManagerApplication({
    session: session ?? FakeSession.signedIn(),
    usersRepository: users ?? new FakeUsersRepository([makeUser()]),
    medicinesRepository: medicines ?? new FakeMedicinesRepository([]),
    settingsRepository: new FakeSettingsRepository(null),
    orderRequestsRepository: orderRequests ?? new FakeOrderRequestsRepository([]),
    ordersRepository: orders ?? new FakeOrdersRepository([]),
    // Stage 14: always supplied, like orders - the composition root requires it,
    // so a default would hide a caller that forgot to wire it.
    stockLogsRepository: new FakeStockLogsRepository(),
    // Stage 15: wired so the receipt path is buildable; these suites never call it.
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
    orderProcessing: new FakeOrderProcessingService(),
  });
}

/**
 * Builds the whole application layer with a STAGED Stage 6 service, so a test can
 * assert on what the Stage 11 use case forwards and how it maps each outcome.
 */
export function buildApplicationWithStage6(
  stage6: FakeOrderProcessingService,
  orderRequests?: FakeOrderRequestsRepository,
  users?: FakeUsersRepository,
): ReturnType<typeof createManagerApplication> {
  return createManagerApplication({
    session: FakeSession.signedIn(),
    usersRepository: users ?? new FakeUsersRepository([makeUser()]),
    medicinesRepository: new FakeMedicinesRepository([]),
    settingsRepository: new FakeSettingsRepository(null),
    orderRequestsRepository: orderRequests ?? new FakeOrderRequestsRepository([]),
    ordersRepository: new FakeOrdersRepository([]),
    // Stage 14: wired so the audit read is buildable; these suites never call it.
    stockLogsRepository: new FakeStockLogsRepository(),
    // Stage 15: wired so the receipt path is buildable; these suites never call it.
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
    orderProcessing: stage6,
  });
}

/** A `UserListItemView` exactly as the Main process projects it. */
export function makeUserView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: 'uid-1',
    name: 'نور',
    employeeId: 'EMP-001',
    role: 'admin',
    status: 'approved',
    hasException: false,
    lastOrderId: null,
    lastOrderDateIso: null,
    lastOrderMonthYear: '',
    lastOrderMonthYearDisplay: null,
    lastOrderStatus: null,
    lastOrderIsException: false,
    ...overrides,
  };
}
