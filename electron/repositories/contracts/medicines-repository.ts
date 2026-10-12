/**
 * Stage 5B - `medicines` and `settings` repository contracts.
 *
 * `firestore.rules`:
 *   - medicines: read for ANY authenticated user, write for `isAdmin()` only
 *   - settings:  read for ANY authenticated user, write for `isAdmin()` only
 *                 and only the fixed document `settings/app` (D9)
 */

import type { AppSettings, Medicine } from '../../domain/models';

export interface MedicinesRepository {
  // ------------------------------------------------------------- READ

  /** Reads one medicine. `null` when absent. */
  getMedicine(medicineId: string): Promise<Medicine | null>;

  /**
   * Lists the catalogue.
   *
   * The REST layer cannot order or paginate with a cursor (Stage 3 limitation),
   * so the result is bounded by an explicit `limit` rather than pretending to
   * be a complete, sorted inventory.
   */
  listMedicines(limit: number): Promise<readonly Medicine[]>;

  // ------------------------------------------------- ADMINISTRATIVE WRITE

  /**
   * Stage 10: sets `maxQuantity`, the per-order cap. Admin only.
   *
   * This is the ONLY medicine write the architecture can justify today, and the
   * reasoning is worth stating because it will be asked again.
   *
   * `maxQuantity` is a POLICY value, not inventory. A2 reads it once, to refuse
   * a single order line above the cap; changing it moves no stock, alters no
   * counter and needs no audit row. Android performs exactly this write as a
   * single-field update (AdminActivity.kt), and firestore.rules permits
   * `isAdmin()` to write the collection.
   *
   * The implementation MUST send an explicit single-field mask. A Firestore
   * `PATCH` without a mask replaces the whole document - the Stage 5A "G3"
   * finding proved a raw `PATCH {"fields":{}}` returns 200 and leaves zero
   * fields - so an unmasked cap edit would silently delete `name`, `stock`,
   * `totalInward` and `totalOutward`.
   *
   * STILL DELIBERATELY NOT PROVIDED
   *  - setStock / adjustStock - inventory. Android couples every stock movement
   *    to a `stock_logs` row, and `StockLogsRepository` exposes no append by
   *    design, so Windows could move stock that no report could explain.
   *  - setTotalInward / setTotalOutward - the same audit coupling, and these
   *    counters are maintained by the Stage 6 processor, not by an editor.
   *  - createMedicine - A4 also writes a `stock_logs` row on creation.
   *  - deleteMedicine - destructive, and not required by the design.
   *  - renameMedicine - Android has no rename operation; the name is written
   *    once at creation.
   */
  setMaxQuantity(medicineId: string, maxQuantity: number): Promise<void>;
}

export interface SettingsRepository {
  // ------------------------------------------------------------- READ

  /**
   * Reads `settings/app`.
   *
   * Returns `null` when the document does not exist, rather than inventing
   * defaults at this level: the mapper already applies the Android engine's own
   * fallbacks per field, and a completely absent document is a different
   * situation the caller must be able to see.
   */
  getAppSettings(): Promise<AppSettings | null>;

  // ------------------------------------------------- ADMINISTRATIVE WRITE

  /** Saves `settings/app`. Admin only; always targets the fixed document id. */
  saveAppSettings(settings: AppSettings): Promise<void>;
}