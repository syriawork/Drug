/**
 * Stage 15 - the production wiring for the inbound-stock transaction.
 *
 * `InboundStockService` deliberately knows nothing about Firestore: it receives a
 * `() => Promise<InboundStockTransaction>` and drives it. This module is the one
 * place that knows the two halves have to be connected, which is why it exists as
 * its own file rather than as a helper inside the service - the same separation
 * `order-processing-transaction-factory.ts` already uses for Stage 6.
 *
 * WHY THE TRANSACTION ID IS BRANDED
 * `FirestoreRestClient.beginTransaction` returns a bare `string`, while the adapter
 * wants a `TransactionId`. The brand stops a caller from passing an arbitrary
 * string where a real transaction handle is required; the cast below is the single
 * deliberate place that promise is made and the only place a rollback can be issued
 * for a handle that really came from `:beginTransaction`.
 */
import type {
  InboundStockTransaction,
  InboundStockTransactionFactory,
  TransactionId,
} from '../contracts/common';
import {
  FirestoreInboundStockTransaction,
  type FirestoreInboundStockTransactionClient,
} from './inbound-stock-transaction';

/**
 * Returns a factory that begins a fresh transaction for every use-case attempt.
 */
export function createInboundStockTransactionFactory(
  client: FirestoreInboundStockTransactionClient,
): InboundStockTransactionFactory {
  return async (): Promise<InboundStockTransaction> => {
    const transactionId = (await client.beginTransaction()) as TransactionId;
    return new FirestoreInboundStockTransaction(client, transactionId);
  };
}