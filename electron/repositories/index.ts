/**
 * Stage 5B - the repositories barrel.
 *
 * Application services import from here. Nothing below this line leaks a
 * Firestore type into the application layer.
 */

export type {
  MedicinesRepository,
  SettingsRepository,
} from './contracts/medicines-repository';
export type {
  OrderRequestsRepository,
  OrdersRepository,
  StockLogsRepository,
} from './contracts/order-repository';
export type { UsersRepository } from './contracts/users-repository';
export type {
  NewInboundStockMovement,
  NewOrder,
  NewStockLog,
  OrderProcessingTransaction,
  InboundStockTransaction,
  InboundStockTransactionFactory,
  TransactionId,
  UserOrderSummaryWrite,
} from './contracts/common';

export {
  FirestoreMedicinesRepository,
  FirestoreSettingsRepository,
} from './firestore/medicines-repository';
export {
  FirestoreOrderRequestsRepository,
  FirestoreOrdersRepository,
  FirestoreStockLogsRepository,
} from './firestore/order-repository';
export { FirestoreUsersRepository } from './firestore/users-repository';
export {
  FirestoreOrderProcessingTransaction,
} from './firestore/order-processing-transaction';
export type {
  FirestoreOrderProcessingTransactionClient,
} from './firestore/order-processing-transaction';
export {
  createOrderProcessingTransactionFactory,
} from './firestore/order-processing-transaction-factory';
export type {
  OrderProcessingTransactionFactory,
  OrderProcessingTransactionFactoryOptions,
} from './firestore/order-processing-transaction-factory';
export {
  mapMedicineStockWrite,
  mapNewOrderWrite,
  mapNewStockLogWrite,
  mapRequestFailedWrite,
  mapRequestProcessedWrite,
  MEDICINE_STOCK_MASK,
  USER_SUMMARY_MASK,
} from './firestore/mappers/order-write-mapper';
export type { RepositoryContext } from './firestore/repository-support';
export { toDomainError } from './firestore/repository-support';
// Stage 10: the single medicine write the architecture supports, and the mask
// that makes it safe. Exported so the application and IPC layers can reason
// about the write without importing the mapper itself.
export {
  MEDICINE_MAX_QUANTITY_MASK,
  mapMedicineMaxQuantityWrite,
} from './firestore/mappers/medicine-mapper';

// Stage 15: the inbound receipt's mask and mappers, plus the transaction that owns
// them. Exported so `main.ts` wires the factory by name, exactly as Stage 6's
// transaction is wired, rather than by importing a Firestore file by path.
export {
  INBOUND_STOCK_TOTALS_MASK,
  mapInboundStockTotalsWrite,
  mapNewInboundStockLogWrite,
} from './firestore/mappers/order-write-mapper';
export { FirestoreInboundStockTransaction } from './firestore/inbound-stock-transaction';
export type {
  FirestoreInboundStockTransactionClient,
} from './firestore/inbound-stock-transaction';
export { createInboundStockTransactionFactory } from './firestore/inbound-stock-transaction-factory';

export { DomainError } from '../domain/errors';