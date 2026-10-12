/**
 * Stage 6 - the production wiring for the order-processing transaction.
 *
 * `FirestoreOrderProcessingService` deliberately knows nothing about Firestore:
 * it receives a `() => Promise<OrderProcessingTransaction>` and retries it. This
 * module is the one place that knows the two halves have to be connected, which
 * is why it exists as its own file rather than as a static helper somewhere.
 *
 * WHY THE TRANSACTION ID IS BRANDED
 * `FirestoreRestClient.beginTransaction` returns a bare `string`, while the
 * adapter wants a `TransactionId`. The brand exists so a caller cannot pass an
 * arbitrary string where a real transaction handle is required; the cast below
 * is the single, deliberate place that promise is made and the only place a
 * rollback can be issued for a handle that really came from `:beginTransaction`.
 */
import type { OrderProcessingTransaction, TransactionId } from '../contracts/common';
import {
  FirestoreOrderProcessingTransaction,
  type FirestoreOrderProcessingTransactionClient,
} from './order-processing-transaction';

export interface OrderProcessingTransactionFactoryOptions {
  /** Diagnostics sink for non-fatal mapper problems. */
  readonly onWarning?: ((message: string) => void) | undefined;
}

/**
 * A factory the service can call on every attempt. Each call MUST return a
 * freshly begun transaction: reusing one would hand the retry loop a finished or
 * half-used handle, which is exactly the failure the bounded retry exists to
 * survive.
 */
export type OrderProcessingTransactionFactory = () => Promise<OrderProcessingTransaction>;

export function createOrderProcessingTransactionFactory(
  client: FirestoreOrderProcessingTransactionClient,
  options: OrderProcessingTransactionFactoryOptions = {},
): OrderProcessingTransactionFactory {
  return async (): Promise<OrderProcessingTransaction> => {
    const transactionId = (await client.beginTransaction()) as TransactionId;
    return new FirestoreOrderProcessingTransaction(client, transactionId, options.onWarning);
  };
}
