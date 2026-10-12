/**
 * Stage 7 - the application result envelope.
 *
 * Every operation in the application layer answers with a VALUE. Nothing is
 * thrown across a use case, and nothing is thrown across IPC.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * When an `ipcMain.handle` listener rejects, Electron builds the renderer's
 * rejection value from the Error's own enumerable properties. Any internal
 * detail that happens to be an own property - a message carrying a document
 * path, a `cause`, a `serverMessage` - travels with it. Returning
 * `ApplicationResult<T>` removes that entire failure mode by construction:
 * `ipcMain.handle` resolves with exactly the bytes built here.
 *
 * This module imports the ambient `ApplicationResult<T>` declared in
 * `src/shared/ipc-contract.d.ts` rather than declaring a second, structurally
 * similar type. One definition, used by both sides of the bridge, is the only
 * way the contract can be guaranteed to match.
 */

import {
  type ApplicationErrorKind,
  ApplicationError,
  toApplicationError,
  toApplicationErrorPayload,
} from './application-error';

/** The success arm, frozen so a payload cannot be mutated after the fact. */
export function applicationSuccess<T>(value: T): ApplicationResult<T> {
  return Object.freeze({ ok: true as const, value });
}

/** The failure arm for an already-classified error. */
export function applicationFailure<T = never>(error: ApplicationError): ApplicationResult<T> {
  return Object.freeze({ ok: false as const, error: toApplicationErrorPayload(error) });
}

/** The failure arm for a code, used for refusals raised before any I/O. */
export function applicationRefusal<T = never>(
  kind: ApplicationErrorKind,
  options: { readonly diagnostic?: string | undefined; readonly retryable?: boolean | undefined } = {},
): ApplicationResult<T> {
  return applicationFailure<T>(new ApplicationError(kind, options));
}

/** The failure arm for anything thrown; classifies and never re-throws. */
export function applicationFailureFrom<T = never>(
  error: unknown,
  onDiagnostic?: ((message: string) => void) | undefined,
): ApplicationResult<T> {
  const applicationError = toApplicationError(error);
  onDiagnostic?.(applicationError.diagnostic);
  return applicationFailure<T>(applicationError);
}

/** Runs a use case and guarantees it can never reject. */
export async function attempt<T>(
  operation: () => Promise<T>,
  onDiagnostic?: ((message: string) => void) | undefined,
): Promise<ApplicationResult<T>> {
  try {
    return applicationSuccess(await operation());
  } catch (error: unknown) {
    return applicationFailureFrom<T>(error, onDiagnostic);
  }
}

export function isApplicationSuccess<T>(
  result: ApplicationResult<T>,
): result is ApplicationSuccess<T> {
  return result.ok;
}

export function isApplicationFailure<T>(
  result: ApplicationResult<T>,
): result is ApplicationFailure {
  return !result.ok;
}
