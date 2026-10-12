/**
 * Stage 5B - `medicines/{id}` <-> domain `Medicine`.
 *
 * Authority: §4.2 of the Stage 4 document, A2 (processing) and A4 (admin UI).
 *
 * Stage 5B is READ-ONLY for this collection: no stock mutation, no create, no
 * delete. The administrative editing that exists in the Android app (A4 adds
 * stock, edits maxQuantity, deletes a medicine) is intentionally NOT ported
 * here; see docs/domain-data-architecture.md §8.
 */

import type { FirestoreWriteRequest } from '../../../services/firestore-rest';
import type { Medicine } from '../../../domain/models';
import {
  type RawFields,
  numberOrDefault,
  requireNumber,
  requireString,
} from './readers';

/**
 * Maps one decoded `medicines/{id}` document.
 *
 * `totalInward` / `totalOutward` are optional in the schema (A2 never reads
 * them) and are read with a documented `0` default so a partially seeded
 * catalogue still maps.
 */
export function mapMedicine(
  documentId: string,
  fields: RawFields,
  documentPath: string,
): Medicine {
  return Object.freeze({
    id: documentId,
    name: requireString(fields, 'name', documentPath),
    // maxQuantity is the per-order cap, NOT the stock; the two are conflated
    // often enough that the distinction is spelled out in the model too.
    maxQuantity: requireNumber(fields, 'maxQuantity', documentPath),
    stock: requireNumber(fields, 'stock', documentPath),
    totalInward: numberOrDefault(fields, 'totalInward', 0),
    totalOutward: numberOrDefault(fields, 'totalOutward', 0),
  });
}

/**
 * Stage 10 - the ONE administrative write `medicines` gains.
 *
 * WHY ONLY `maxQuantity`
 * The Android admin screen (A4) performs four medicine writes, and they are not
 * equivalent:
 *
 *   edit maxQuantity   single-field `update("maxQuantity", n)`   <-- PORTED HERE
 *   add stock inward   `update(stock: +q, totalInward: +q)` PLUS a `stock_logs`
 *                      audit entry                              <-- NOT PORTED
 *   create medicine    `set(...)` PLUS a `stock_logs` entry      <-- NOT PORTED
 *   delete medicine    `delete()`                                <-- NOT PORTED
 *
 * Only the first is a POLICY edit. The other three are inventory mutations, and
 * every one of them on Android also writes a `stock_logs` row so the movement
 * lands in the audit trail. Windows cannot write `stock_logs` at all: the Stage
 * 5B `StockLogsRepository` contract has no `appendStockLog`, by design. Exposing
 * a stock edit without its audit entry would create inventory that no report can
 * explain, which is worse than not offering the button.
 *
 * `maxQuantity` is safe on its own because it is the per-order CAP, not
 * inventory: A2 reads it only to refuse a single oversized order line, and
 * changing it moves no stock, alters no counter and writes no log.
 *
 * WHY AN EXPLICIT MASK IS NOT OPTIONAL
 * A Firestore REST `PATCH` without an update mask REPLACES the whole document
 * (the Stage 5A "G3" finding: a raw `PATCH {"fields":{}}` returns 200 and leaves
 * zero fields). A mask-less maxQuantity edit would therefore silently delete
 * `name`, `stock`, `totalInward` and `totalOutward`. `MEDICINE_MAX_QUANTITY_MASK`
 * names exactly one field, and the Stage 5A client REFUSES any mask path absent
 * from the data, so the mask and the payload cannot drift apart.
 */

/** The exact mask for a `maxQuantity` edit: one field, nothing else. */
export const MEDICINE_MAX_QUANTITY_MASK: readonly string[] = Object.freeze(['maxQuantity']);

/**
 * Builds the masked `maxQuantity` update.
 *
 * `updateMaskPaths` is what keeps `stock` and the two counters intact, and it is
 * produced HERE - next to the payload - so the two can never disagree.
 */
export function mapMedicineMaxQuantityWrite(
  medicineId: string,
  maxQuantity: number,
): FirestoreWriteRequest {
  return {
    kind: 'update',
    relativePath: `medicines/${medicineId}`,
    data: { maxQuantity },
    updateMaskPaths: MEDICINE_MAX_QUANTITY_MASK,
  };
}

/**
 * Builds the payload for a NEW medicine (A4 "add medicine" dialog).
 *
 * Provided so Stage 5B can prove the write mapping; the repository that exposes
 * it is intentionally not part of the public read surface yet.
 */
export function mapNewMedicine(input: {
  readonly name: string;
  readonly maxQuantity: number;
  readonly initialStock: number;
}): Record<string, unknown> {
  return {
    name: input.name,
    maxQuantity: input.maxQuantity,
    stock: input.initialStock,
    // A4 initialises both counters with the opening stock.
    totalInward: input.initialStock,
    totalOutward: 0,
  };
}

/** Reads a medicine id out of a `medicines/<id>` relative path. */
export function medicineIdFromPath(relativePath: string): string {
  const parts = relativePath.split('/');
  if (parts.length !== 2 || parts[0] !== 'medicines') {
    throw new Error(`not a medicines path: ${relativePath}`);
  }
  return parts[1] ?? '';
}