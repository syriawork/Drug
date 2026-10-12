/**
 * Stage 10 - the medicine-management use cases.
 *
 * THE WRITE SURFACE IS ONE FIELD, AND THAT IS THE POINT
 *
 * `maxQuantity` is the per-order CAP. It is the only medicine field this
 * architecture can safely edit, and the reason is an audit coupling rather than
 * a technical one: on Android, every other medicine write (add stock, create,
 * delete) also writes a `stock_logs` row. Windows has no `appendStockLog` - the
 * Stage 5B `StockLogsRepository` has none by design - so any inventory edit
 * exposed here would produce stock movement that no report could explain. A
 * missing button is recoverable; an unexplainable inventory is not.
 *
 * `name` is also read-only, and not by omission: Android has NO rename
 * operation at all. A name is written once, at creation.
 *
 * WHY UNKNOWN KEYS ARE REFUSED
 * The payload is checked against an allowlist and an unexpected key is a
 * `VALIDATION_FAILED` refusal, exactly as in the Stage 9 user update. Silently
 * dropping `stock: 999` would let a buggy renderer believe it moved inventory.
 *
 * WHY NOTHING HERE DECIDES AUTHORIZATION
 * The only local check is session PRESENCE. A caller who is not an admin reaches
 * the network and firestore.rules answers 403, which is the whole point; the
 * Stage 10 emulator suite proves it against a real engine.
 */

import type { MedicinesRepository } from '../repositories/contracts/medicines-repository';
import { applicationFailureFrom, applicationRefusal, applicationSuccess } from './application-result';

/** Supplies the current safe auth state; never a token. */
export interface AuthStateSource {
  getState(): SafeAuthState;
}

/** The exact keys a medicine update may carry. */
const ALLOWED_UPDATE_KEYS: ReadonlySet<string> = new Set<string>(['medicineId', 'maxQuantity']);

/**
 * A medicine id must survive being used as a document id - letters, digits,
 * `_` and `-` only, so a crafted id can never address a document outside
 * `medicines/`.
 */
const MEDICINE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * NO BUSINESS RANGE IS INVENTED HERE
 *
 * The obvious question for an edit like this is "what are the legal values?", and
 * the honest answer is that this repository has no answer to give, because no
 * source of truth states one:
 *
 *   - Android (A4) does `input.text.toString().toIntOrNull() ?: medicine.maxQuantity`
 *     and writes it. There is no range check, no lower bound and no upper bound
 *     anywhere in the admin screen.
 *   - The Cloud Functions processor only COMPARES against the cap
 *     (`requestedQty > medData.maxQuantity`) and never constrains how it was set.
 *   - The read mapper `requireNumber` requires a whole number and nothing more.
 *
 * Inventing `1..1000` here would have been the easy answer, and it would have
 * been wrong twice over: it would silently REFUSE edits the Android administrator
 * can legitimately make (a cap above 1000 is a real possibility for a bulk
 * issue), and it would make the Windows app enforce a policy its sibling client
 * does not. This module validates only what the storage layer actually requires -
 * a number this application can represent exactly - and leaves the business
 * question to the administrator, which is where Android leaves it too.
 */
const MAX_SAFE_FIRESTORE_INTEGER = Number.MAX_SAFE_INTEGER;

export interface MedicinesManagementServiceOptions {
  readonly medicines: MedicinesRepository;
  readonly auth: AuthStateSource;
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}

/** The validated form of an update, once the payload has been trusted. */
interface ValidatedMaxQuantityUpdate {
  readonly medicineId: string;
  readonly maxQuantity: number;
}

export class MedicinesManagementService {
  private readonly medicines: MedicinesRepository;
  private readonly auth: AuthStateSource;
  private readonly onDiagnostic: ((message: string) => void) | undefined;

  public constructor(options: MedicinesManagementServiceOptions) {
    this.medicines = options.medicines;
    this.auth = options.auth;
    this.onDiagnostic = options.onDiagnostic;
  }

  /** Validates the payload without performing any I/O. */
  public validateUpdate(payload: unknown): ApplicationResult<ValidatedMaxQuantityUpdate> {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'the update payload must be an object' });
    }

    const candidate = payload as Record<string, unknown>;

    // Refusing an unexpected key is what makes `stock`, `totalInward`,
    // `totalOutward` and `name` unreachable rather than merely ignored.
    for (const key of Object.keys(candidate)) {
      if (!ALLOWED_UPDATE_KEYS.has(key)) {
        return applicationRefusal('VALIDATION_FAILED', {
          diagnostic: `refused an update carrying the unsupported key "${key}"`,
        });
      }
    }

    const medicineId = candidate['medicineId'];
    if (typeof medicineId !== 'string' || !MEDICINE_ID_PATTERN.test(medicineId)) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'refused a malformed medicine id' });
    }

    const maxQuantity = candidate['maxQuantity'];
    if (typeof maxQuantity !== 'number' || !Number.isInteger(maxQuantity)) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'refused a non-integer maxQuantity' });
    }
    // A number beyond 2^53-1 cannot survive the JSON round trip to Firestore
    // intact, so accepting it would store something the user never typed. This
    // is a storage guarantee, not a policy.
    if (Math.abs(maxQuantity) > MAX_SAFE_FIRESTORE_INTEGER) {
      return applicationRefusal('VALIDATION_FAILED', {
        diagnostic: 'refused a maxQuantity that cannot be represented exactly',
      });
    }

    return applicationSuccess({ medicineId, maxQuantity });
  }

  /**
   * Applies the one supported medicine edit.
   *
   * Never throws: every outcome comes back as an `ApplicationResult`. A write
   * answers "did it work"; the caller re-reads the list to learn the truth,
   * because a masked write leaves every other field alone and only a fresh read
   * can prove what is stored.
   */
  public async setMaxQuantity(payload: unknown): Promise<ApplicationResult<null>> {
    const validated = this.validateUpdate(payload);
    if (!validated.ok) {
      return validated;
    }

    // Session presence only. It grants nothing and refuses nothing on the basis
    // of a role; it just avoids a pointless round trip.
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'setMaxQuantity without a Main-process session',
      });
    }

    try {
      await this.medicines.setMaxQuantity(validated.value.medicineId, validated.value.maxQuantity);
      return applicationSuccess(null);
    } catch (error: unknown) {
      return applicationFailureFrom<null>(error, this.onDiagnostic);
    }
  }
}