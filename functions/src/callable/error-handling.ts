import { logger } from 'firebase-functions';
import { HttpsError } from 'firebase-functions/v2/https';

export interface CallableDiagnostics {
  error(message: string, context: Readonly<Record<string, string>>): void;
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export async function withSafeCallableErrors<T>(
  operation: string,
  action: () => Promise<T>,
  diagnostics: CallableDiagnostics = logger,
): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    if (error instanceof HttpsError) {
      throw error;
    }

    diagnostics.error('Callable operation failed unexpectedly.', {
      operation,
      errorType: errorType(error),
    });
    throw new HttpsError('internal', 'An unexpected error occurred.');
  }
}
