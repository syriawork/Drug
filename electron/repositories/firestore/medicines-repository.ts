/**
 * Stage 5B - Firestore implementation of the `medicines` and `settings`
 * repositories. Both are read-mostly; `settings` additionally has the one
 * administrative save the Android settings screen performs.
 */

import type { AppSettings, Medicine } from '../../domain/models';
import type { MedicinesRepository, SettingsRepository } from '../contracts/medicines-repository';
import { mapMedicine, mapMedicineMaxQuantityWrite } from './mappers/medicine-mapper';
import {
  APP_SETTINGS_DOCUMENT_ID,
  APP_SETTINGS_PATH,
  mapAppSettings,
  mapAppSettingsWrite,
} from './mappers/order-mapper';
import {
  type RepositoryContext,
  documentIdOf,
  documentPath,
  requireId,
  requirePositiveLimit,
  toDomainError,
} from './repository-support';

const MEDICINES = 'medicines';

export class FirestoreMedicinesRepository implements MedicinesRepository {
  private readonly context: RepositoryContext;

  public constructor(context: RepositoryContext) {
    this.context = context;
  }

  public async getMedicine(medicineId: string): Promise<Medicine | null> {
    const safeId = requireId(medicineId, 'medicineId');
    const path = documentPath(MEDICINES, safeId);
    try {
      const document = await this.context.client.getDocumentOrNull(path);
      if (document === null) {
        return null;
      }
      return mapMedicine(documentIdOf(document), document.data, path);
    } catch (error: unknown) {
      throw toDomainError(error, path);
    }
  }

  public async listMedicines(limit: number): Promise<readonly Medicine[]> {
    const safeLimit = requirePositiveLimit(limit);
    try {
      const result = await this.context.client.listDocuments(MEDICINES, { pageSize: safeLimit });
      return Object.freeze(result.documents.map((document) => (
        mapMedicine(documentIdOf(document), document.data, document.relativePath)
      )));
    } catch (error: unknown) {
      throw toDomainError(error, MEDICINES);
    }
  }

  /**
   * Stage 10: sets the per-order cap with an EXPLICIT single-field mask.
   *
   * The mask is the whole safety story here. Without it the REST `PATCH` would
   * REPLACE the document and delete `name`, `stock`, `totalInward` and
   * `totalOutward`; with it, only `maxQuantity` changes. The mask is produced by
   * the mapper beside the payload, so the two cannot drift apart.
   *
   * SECURITY: this method does not inspect a role. firestore.rules answers
   * 401/403 for a non-admin caller, and `toDomainError` turns that into
   * `NOT_AUTHORIZED`. The client never decides.
   */
  public async setMaxQuantity(medicineId: string, maxQuantity: number): Promise<void> {
    const safeId = requireId(medicineId, 'medicineId');
    const path = documentPath(MEDICINES, safeId);
    const write = mapMedicineMaxQuantityWrite(safeId, maxQuantity);

    try {
      await this.context.client.commitWrites([write]);
    } catch (error: unknown) {
      throw toDomainError(error, path);
    }
  }
}

export class FirestoreSettingsRepository implements SettingsRepository {
  private readonly context: RepositoryContext;

  public constructor(context: RepositoryContext) {
    this.context = context;
  }

  public async getAppSettings(): Promise<AppSettings | null> {
    try {
      const document = await this.context.client.getDocumentOrNull(APP_SETTINGS_PATH);
      if (document === null) {
        // Absence is reported, not invented: the mapper's per-field fallbacks
        // describe a document that exists, not one that does not.
        return null;
      }
      return mapAppSettings(document.data);
    } catch (error: unknown) {
      throw toDomainError(error, APP_SETTINGS_PATH);
    }
  }

  public async saveAppSettings(settings: AppSettings): Promise<void> {
    try {
      await this.context.client.commitWrites([{
        // Always the fixed id: writing settings/schedule would silently create a
        // document the Android client never reads (D9).
        relativePath: APP_SETTINGS_PATH,
        data: mapAppSettingsWrite(settings),
        kind: 'update',
        updateMaskPaths: Object.freeze([
          'minDaysBetweenOrders',
          'maxDailyOrders',
          'allowFridayOrders',
          'startTime',
          'endTime',
          'assistantId',
        ]),
      }]);
    } catch (error: unknown) {
      throw toDomainError(error, APP_SETTINGS_PATH);
    }
  }
}

export { APP_SETTINGS_DOCUMENT_ID };
