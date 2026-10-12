/**
 * Stage 5B - Firestore implementation of the `users` repository.
 *
 * READ:  GET `users/{uid}`, and a bounded list for admins.
 * WRITE: every administrative write is MASKED (Stage 5A C5) so that updating
 *        `status` can never erase the `lastOrder*` summary.
 *
 * SECURITY: this class never inspects a role. `approveUser` is "isAdmin() only"
 * because firestore.rules says so; the client just sends the request and
 * translates the verdict. An employee calling it receives `NOT_AUTHORIZED`.
 */

import type { User, UserStatus } from '../../domain/models';
import type { UsersRepository } from '../contracts/users-repository';
import { mapUser, mapUserAdministrativeUpdate } from './mappers/user-mapper';
import {
  type RepositoryContext,
  documentIdOf,
  documentPath,
  requireId,
  toDomainError,
} from './repository-support';

const COLLECTION = 'users';

/** Upper bound on a single list page, mirroring the Android admin screen. */
const MAX_LIST_LIMIT = 500;

export class FirestoreUsersRepository implements UsersRepository {
  private readonly context: RepositoryContext;

  public constructor(context: RepositoryContext) {
    this.context = context;
  }

  public async getUser(uid: string): Promise<User | null> {
    const safeUid = requireId(uid, 'uid');
    const path = documentPath(COLLECTION, safeUid);

    try {
      const document = await this.context.client.getDocumentOrNull(path);
      if (document === null) {
        return null;
      }
      return mapUser(documentIdOf(document), document.data, path, {
        onWarning: (warning) => this.context.onWarning?.(`${path}: ${warning.field} ${warning.detail}`),
      });
    } catch (error: unknown) {
      throw toDomainError(error, path);
    }
  }

  public async listAllUsers(): Promise<readonly User[]> {
    const limit = MAX_LIST_LIMIT;
    try {
      const result = await this.context.client.listDocuments(COLLECTION, { pageSize: limit });
      return Object.freeze(result.documents.map((document) => {
        const path = document.relativePath;
        return mapUser(documentIdOf(document), document.data, path, {
          onWarning: (warning) => this.context.onWarning?.(`${path}: ${warning.field} ${warning.detail}`),
        });
      }));
    } catch (error: unknown) {
      throw toDomainError(error, COLLECTION);
    }
  }

  public async approveUser(uid: string): Promise<void> {
    await this.updateStatus(uid, 'approved');
  }

  public async rejectUser(uid: string): Promise<void> {
    await this.updateStatus(uid, 'rejected');
  }

  public async grantSingleOrderException(uid: string): Promise<void> {
    await this.updateFields(uid, { hasException: true });
  }

  public async revokeSingleOrderException(uid: string): Promise<void> {
    await this.updateFields(uid, { hasException: false });
  }

  public async renameUser(uid: string, name: string): Promise<void> {
    await this.updateFields(uid, { name });
  }

  private async updateStatus(uid: string, status: UserStatus): Promise<void> {
    await this.updateFields(uid, { status });
  }

  /**
   * The single write path. `mapUserAdministrativeUpdate` produces both the data
   * and the matching mask, so the two can never drift apart.
   */
  private async updateFields(
    uid: string,
    changes: { readonly name?: string; readonly status?: UserStatus; readonly hasException?: boolean },
  ): Promise<void> {
    const safeUid = requireId(uid, 'uid');
    const path = documentPath(COLLECTION, safeUid);
    const { data, maskPaths } = mapUserAdministrativeUpdate(changes);

    try {
      await this.context.client.commitWrites([{
        relativePath: path,
        data,
        kind: 'update',
        updateMaskPaths: maskPaths,
      }]);
    } catch (error: unknown) {
      throw toDomainError(error, path);
    }
  }
}
