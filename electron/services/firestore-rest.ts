import { randomInt } from 'node:crypto';

import {
  type FirestoreRestConfig,
  FirestoreConfigError,
  assertLocalFirestoreTarget,
  assertSafeRelativePath,
  buildFirestoreDocumentResourceName,
  buildFirestoreDocumentsUrlPrefix,
  isFirestoreConfigured,
  isRemoteTargetAllowed,
} from '../config/firestore-config';
import {
  type FirestoreDocumentData,
  type FirestoreFields,
  FirestoreCodecError,
  decodeFields,
  encodeFields,
  encodeFieldPathSegments,
  encodeValue,
  extractServerTimestamps,
  parseFieldPath,
} from './firestore-codec';

/**
 * Minimal typed Firestore REST client for the Electron MAIN process (Stage 3).
 *
 * Architectural contract (non-negotiable):
 *  - Talks to the official Firestore REST API with `fetch` (no SDK at all).
 *  - Authenticates with a normal per-user Firebase ID token obtained from the
 *    Stage 2 authentication layer (`FirebaseAuthService.getValidIdToken`).
 *  - Therefore Firebase Security Rules - the ones shipped with the Android
 *    project - are the only authorization boundary. The client performs NO
 *    client-side role or status checks: it cannot, it does not know them.
 *  - Tokens never leave this process, are never logged, never persisted, and
 *    are never included in error objects (see sanitizeServerMessage).
 *  - Only the operations required by this stage are implemented: get, list,
 *    create, patch/update, query, and the transaction primitives
 *    (beginTransaction / batchGet / commit / rollback).
 *
 * Stage 5A hardening (see docs/firestore-rest-architecture.md):
 *  - `commitWrites` sends a real Firestore `updateMask` for partial updates
 *    (explicit `updateMaskPaths`, or derived for `kind: 'update'` — the C5 fix);
 *  - `SERVER_TIMESTAMP` values become `updateTransforms` with
 *    `setToServerValue: REQUEST_TIME` (never a client-clock string);
 *  - malformed masks/transforms and write shapes that would silently delete or
 *    ignore data are rejected BEFORE any request is sent;
 *  - `generateAutoId()` provides the documented 20-character client-side id.
 */

export type FirestoreRestReason =
  | 'CONFIGURATION_ERROR'
  | 'NETWORK'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'FAILED_PRECONDITION'
  | 'INVALID_ARGUMENT'
  /**
   * Stage 6: a Firestore transaction was aborted because a document it read
   * changed before the commit (HTTP 409 with gRPC status `ABORTED`).
   *
   * This is a DISTINCT outcome from `ALREADY_EXISTS`, and conflating the two is
   * actively misleading: a conflict says "retry with fresh reads", while a
   * duplicate says "pick another id". Firestore returns both as HTTP 409, so the
   * gRPC status name is what disambiguates them.
   */
  | 'ABORTED'
  | 'UNKNOWN';

export interface FirestoreRestErrorOptions {
  readonly reason: FirestoreRestReason;
  readonly message: string;
  readonly httpStatus: number;
  /** False when the request was never sent (configuration/token failure). */
  readonly requestSent: boolean;
  readonly serverMessage?: string | undefined;
}

export class FirestoreRestError extends Error {
  public readonly reason: FirestoreRestReason;
  public readonly httpStatus: number;
  public readonly requestSent: boolean;
  public readonly serverMessage: string | null;

  public constructor(options: FirestoreRestErrorOptions) {
    super(options.message);
    this.name = 'FirestoreRestError';
    this.reason = options.reason;
    this.httpStatus = options.httpStatus;
    this.requestSent = options.requestSent;
    this.serverMessage = options.serverMessage ?? null;
  }

  /** True when Firestore Security Rules (or the missing token) denied the request. */
  public get isAuthorizationDenied(): boolean {
    return this.httpStatus === 401 || this.httpStatus === 403;
  }
}

const JWT_LIKE_PATTERN = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;
const API_KEY_PATTERN = /key=[^&\s"']+/gi;

/**
 * Removes every token-like fragment from a server message before it is stored
 * on an error object (defence in depth: a message can never leak a token even
 * if a proxy decides to echo request headers back).
 */
export function sanitizeServerMessage(rawMessage: string): string {
  return rawMessage
    .replace(JWT_LIKE_PATTERN, '[redacted-token]')
    .replace(BEARER_PATTERN, 'Bearer [redacted-token]')
    .replace(API_KEY_PATTERN, 'key=[redacted]');
}

/** A Firestore document decoded into plain JavaScript data. */
export interface FirestoreDocument {
  /** Full resource name: projects/{p}/databases/{d}/documents/{path}. */
  readonly name: string;
  /** Relative path inside the database, e.g. "users/uid-1". */
  readonly relativePath: string;
  readonly createTime: string | null;
  readonly updateTime: string | null;
  readonly data: FirestoreDocumentData;
}

export interface FirestoreListResult {
  readonly documents: readonly FirestoreDocument[];
  readonly nextPageToken: string | null;
}

export type FirestoreWriteKind = 'upsert' | 'create' | 'update';

export interface FirestoreWriteRequest {
  readonly relativePath: string;
  /**
   * Ordinary field values. A value may be the explicit `SERVER_TIMESTAMP`
   * marker; such fields are removed from `data` and sent as Firestore field
   * transforms (`updateTransforms[].setToServerValue = REQUEST_TIME`) instead.
   */
  readonly data: Record<string, unknown>;
  /** "create" adds an exists=false precondition, "update" exists=true, "upsert" none. */
  readonly kind?: FirestoreWriteKind | undefined;
  /**
   * Explicit Firestore `updateMask` (PART 1): only the listed field paths are
   * written; every other existing field is left unchanged. Field paths follow
   * the Firestore grammar and are validated/encoded before the request is sent.
   *
   * Semantics per `kind` (verified against the local emulator):
   *  - `update`  : when omitted, the mask is DERIVED from the top-level keys of
   *                `data` (partial update — the C5 fix, matching Android's
   *                `transaction.update(ref, map)` behaviour). Pass an explicit
   *                mask for nested precision (e.g. `['meta.at']`) or `[]` for a
   *                transform-only write.
   *  - `upsert`  : when omitted, the document is FULLY REPLACED by `data`
   *                (existing, unchanged semantics). An explicit mask turns it
   *                into a partial merge.
   *  - `create`  : when omitted, all of `data` is written (existing, unchanged
   *                semantics). An explicit mask filters which input fields are
   *                written, so `data` must be fully covered by the mask.
   *
   * Safety rules enforced before any network call (a violation throws instead
   * of silently performing a different operation):
   *  - a mask path that exists in neither `data` nor the transforms would DELETE
   *    that field on the server -> rejected;
   *  - a `data` field outside the mask would be silently IGNORED -> rejected;
   *  - an effectively empty write (no fields and no transforms) -> rejected.
   */
  readonly updateMaskPaths?: readonly string[] | undefined;
}

export interface FirestoreCommitResult {
  readonly commitTime: string | null;
  readonly writeCount: number;
}

export interface FirestoreFieldFilter {
  readonly field: string;
  readonly op: 'EQUAL';
  readonly value: unknown;
}

export interface FirestoreStructuredQuery {
  /** Collection path, e.g. "orders" or "users/uid-1/orders". */
  readonly collectionId: string;
  readonly where?: FirestoreFieldFilter | undefined;
  readonly limit?: number | undefined;
}

export interface ListDocumentsOptions {
  readonly pageSize?: number | undefined;
  readonly pageToken?: string | undefined;
}

export interface PatchDocumentOptions {
  /**
   * Field paths to update (Firestore `updateMask`); omitted means "replace the
   * whole document". Paths follow the Firestore field-path grammar and are
   * validated + encoded (backtick quoting) before the request is sent. The
   * same safety rules as `commitWrites` apply: a mask path absent from `data`
   * would delete the field, and a data field absent from the mask would be
   * silently ignored — both are rejected before any network call. Server
   * timestamps (`SERVER_TIMESTAMP`) cannot be expressed through PATCH and are
   * rejected by the codec; use `commitWrites` for transforms.
   */
  readonly updateMaskPaths?: readonly string[] | undefined;
  readonly precondition?: 'none' | 'exists' | 'missing' | undefined;
}

/** The only thing this client needs from the authentication layer. */
export type FirestoreAccessTokenProvider = () => Promise<string | null>;

export interface FirestoreRestClientOptions {
  readonly config: FirestoreRestConfig;
  readonly getAccessToken: FirestoreAccessTokenProvider;
  readonly fetchImpl?: typeof fetch;
  /** Never true in Stage 3 unless the operator opted in. */
  readonly allowRemoteTarget?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNextPageToken(record: Record<string, unknown>): string | null {
  const value = record['nextPageToken'];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new FirestoreRestError({
      reason: 'UNKNOWN',
      httpStatus: 0,
      requestSent: true,
      message: 'استجابة Firestore غير متوقعة أثناء تنفيذ listDocuments',
    });
  }
  return value;
}

/** Maps a gRPC status name (as returned by Firestore) to a typed reason. */
function reasonFromStatusName(statusName: string): FirestoreRestReason | null {
  switch (statusName) {
    case 'UNAUTHENTICATED':
      return 'UNAUTHENTICATED';
    case 'PERMISSION_DENIED':
      return 'PERMISSION_DENIED';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'ALREADY_EXISTS':
      return 'ALREADY_EXISTS';
    // Stage 6: a transaction conflict, NOT a duplicate. Firestore uses HTTP 409
    // for both, so this case is what keeps the two apart.
    case 'ABORTED':
      return 'ABORTED';
    case 'FAILED_PRECONDITION':
      return 'FAILED_PRECONDITION';
    case 'INVALID_ARGUMENT':
      return 'INVALID_ARGUMENT';
    default:
      return null;
  }
}

/** Maps a plain HTTP status code to a typed reason. */
function reasonFromHttpStatus(httpStatus: number): FirestoreRestReason {
  switch (httpStatus) {
    case 400:
      return 'INVALID_ARGUMENT';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'PERMISSION_DENIED';
    case 404:
      return 'NOT_FOUND';
    case 409:
      // Ambiguous on its own: Firestore returns 409 for BOTH `ALREADY_EXISTS`
      // (duplicate id) and `ABORTED` (transaction conflict). The gRPC status name
      // resolves it, so this fallback keeps the historical meaning and
      // `reasonFromStatusName` upgrades a conflict to 'ABORTED'.
      return 'ALREADY_EXISTS';
    case 412:
      return 'FAILED_PRECONDITION';
    default:
      return 'UNKNOWN';
  }
}

interface SendJsonOptions {
  readonly body?: unknown;
}

// ---------------------------------------------------------------------------
// Stage 5A: update-mask / field-transform write construction (PART 1 + PART 2).
//
// The wire shapes below were verified against the local Firestore Emulator
// (see docs/firestore-rest-architecture.md, "Stage 5A"):
//   Write              = { update, updateMask?, updateTransforms?, currentDocument? }
//   updateMask         = { fieldPaths: string[] }
//   updateTransforms   = [{ fieldPath, setToServerValue: "REQUEST_TIME" }]
// ---------------------------------------------------------------------------

/** A pre-send request-shape error: nothing was written, nothing was sent. */
function invalidWriteError(message: string): FirestoreRestError {
  return new FirestoreRestError({
    reason: 'INVALID_ARGUMENT',
    httpStatus: 0,
    requestSent: false,
    message,
  });
}

/** True for plain data maps only (Date/timestamp instances are leaves). */
function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Joins path segments into a collision-free lookup key. */
function pathKey(path: readonly string[]): string {
  return path.join(' ');
}

function pathEquals(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

/** True when `prefix` is a strict whole-segment prefix of `path`. */
function isProperPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  if (prefix.length >= path.length) {
    return false;
  }
  return prefix.every((segment, index) => segment === path[index]);
}

/** Every key path of every plain map inside `fields` (any depth). */
function collectNodePaths(fields: Record<string, unknown>): string[][] {
  const paths: string[][] = [];
  const walk = (node: Record<string, unknown>, prefix: readonly string[]): void => {
    for (const key of Object.keys(node)) {
      const path = [...prefix, key];
      paths.push(path);
      const value: unknown = node[key];
      if (isPlainDataObject(value)) {
        walk(value, path);
      }
    }
  };
  walk(fields, []);
  return paths;
}

/**
 * Leaf paths of `fields`: values that are not non-empty plain maps.
 * Empty maps (including the leftovers of a server-timestamp extraction) are
 * skipped on purpose — they carry no value of their own.
 */
function collectDataLeafPaths(fields: Record<string, unknown>): string[][] {
  const paths: string[][] = [];
  const walk = (node: Record<string, unknown>, prefix: readonly string[]): void => {
    for (const key of Object.keys(node)) {
      const path = [...prefix, key];
      const value: unknown = node[key];
      if (isPlainDataObject(value)) {
        if (Object.keys(value).length > 0) {
          walk(value, path);
        }
        continue;
      }
      paths.push(path);
    }
  };
  walk(fields, []);
  return paths;
}

/**
 * Shared safety rules for any masked write (commit + patch), verified against
 * the local emulator:
 *  1. DELETION guard — every mask path must exist in `data` or be exactly a
 *     transform target; Firestore deletes mask paths absent from the input.
 *  2. SILENT-IGNORE guard — every leaf of `data` must be covered by the mask
 *     (equal to, or under, some mask path); Firestore ignores input fields the
 *     mask does not mention.
 */
function validateMaskedWrite(
  relativePath: string,
  fields: Record<string, unknown>,
  transformPaths: readonly (readonly string[])[],
  maskPaths: readonly (readonly string[])[],
): void {
  const nodeKeys = new Set(collectNodePaths(fields).map(pathKey));
  const transformKeys = new Set(transformPaths.map(pathKey));

  for (const maskPath of maskPaths) {
    const key = pathKey(maskPath);
    if (!nodeKeys.has(key) && !transformKeys.has(key)) {
      const display = encodeFieldPathSegments(maskPath);
      throw invalidWriteError(
        `updateMask path "${display}" of write "${relativePath}" exists in neither data nor a `
        + 'server-timestamp transform; Firestore would DELETE that field from the document. '
        + 'Add the field to data, cover it with a transform, or remove it from updateMaskPaths.',
      );
    }
  }

  for (const leaf of collectDataLeafPaths(fields)) {
    const covered = maskPaths.some((maskPath) => pathEquals(maskPath, leaf) || isProperPathPrefix(maskPath, leaf));
    if (!covered) {
      const display = encodeFieldPathSegments(leaf);
      throw invalidWriteError(
        `data field "${display}" of write "${relativePath}" is not covered by updateMaskPaths; `
        + 'Firestore would silently IGNORE it. Add it to updateMaskPaths or remove it from data.',
      );
    }
  }
}

/** Firestore's 20-character Auto-ID alphabet (documented client-side id format). */
const FIRESTORE_AUTO_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const FIRESTORE_AUTO_ID_LENGTH = 20;

/**
 * Generates a Firestore-style 20-character Auto-ID for the rare case where the
 * application must produce a document id client-side (e.g. a transaction that
 * creates `order_requests/{id}` and therefore cannot ask Firestore's
 * CreateDocument endpoint to mint the id). Uses `crypto.randomInt`, so the
 * distribution is unbiased; every result is accepted by
 * `assertSafeRelativePath`. Not a framework — one function, no dependencies.
 */
export function generateAutoId(): string {
  let id = '';
  for (let index = 0; index < FIRESTORE_AUTO_ID_LENGTH; index += 1) {
    id += FIRESTORE_AUTO_ID_ALPHABET.charAt(randomInt(FIRESTORE_AUTO_ID_ALPHABET.length));
  }
  return id;
}


export class FirestoreRestClient {
  private readonly config: FirestoreRestConfig;
  private readonly getAccessToken: FirestoreAccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly allowRemoteTarget: boolean;

  public constructor(options: FirestoreRestClientOptions) {
    this.config = options.config;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.allowRemoteTarget = options.allowRemoteTarget ?? isRemoteTargetAllowed();
  }

  /** True when projectId/databaseId are present (no network is performed here). */
  public isConfigured(): boolean {
    return isFirestoreConfigured(this.config);
  }

  public getConfig(): FirestoreRestConfig {
    return this.config;
  }

  /** Full resource name of a document, e.g. projects/p/databases/(default)/documents/users/u1. */
  public toResourceName(relativePath: string): string {
    assertSafeRelativePath(relativePath);
    return buildFirestoreDocumentResourceName(this.config, relativePath);
  }

  /** GET /v1/projects/{p}/databases/{d}/documents/{path} */
  public async getDocument(relativePath: string): Promise<FirestoreDocument> {
    const payload = await this.sendJson('GET', this.documentUrl(relativePath), {});
    return this.toDocument(payload);
  }

  /** Same as getDocument but returns null (instead of throwing) for a missing document. */
  public async getDocumentOrNull(relativePath: string): Promise<FirestoreDocument | null> {
    try {
      return await this.getDocument(relativePath);
    } catch (error: unknown) {
      if (error instanceof FirestoreRestError && error.reason === 'NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  /** GET /v1/projects/{p}/databases/{d}/documents/{collection} (ListDocuments) */
  public async listDocuments(
    collectionPath: string,
    options: ListDocumentsOptions = {},
  ): Promise<FirestoreListResult> {
    assertSafeRelativePath(collectionPath);

    const params = new URLSearchParams();
    if (options.pageSize !== undefined) {
      params.set('pageSize', String(options.pageSize));
    }
    if (options.pageToken !== undefined) {
      params.set('pageToken', options.pageToken);
    }
    const query = params.toString();
    const url = `${this.documentsPrefix()}/${collectionPath}${query.length > 0 ? `?${query}` : ''}`;

    const payload = await this.sendJson('GET', url, {});
    const record = asRecord(payload);
    if (record === null) {
      throw this.invalidResponseError('listDocuments');
    }
    const rawDocuments = record?.['documents'];
    if (rawDocuments !== undefined && !Array.isArray(rawDocuments)) {
      throw this.invalidResponseError('listDocuments');
    }
    const documents = Array.isArray(rawDocuments)
      ? rawDocuments.map((entry) => this.toDocument(entry))
      : [];

    return Object.freeze({
      documents: Object.freeze(documents),
      nextPageToken: readNextPageToken(record),
    });
  }

  /** POST /v1/projects/{p}/databases/{d}/documents:runQuery */
  public async runQuery(
    query: FirestoreStructuredQuery,
    transaction?: string,
  ): Promise<readonly FirestoreDocument[]> {
    assertSafeRelativePath(query.collectionId);

    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: query.collectionId }],
    };
    if (query.where !== undefined) {
      structuredQuery['where'] = {
        fieldFilter: {
          field: { fieldPath: query.where.field },
          op: query.where.op,
          value: encodeValue(query.where.value),
        },
      };
    }
    if (query.limit !== undefined) {
      structuredQuery['limit'] = query.limit;
    }

    const body: Record<string, unknown> = { structuredQuery };
    if (transaction !== undefined) {
      body['transaction'] = transaction;
    }

    const payload = await this.sendJson('POST', `${this.documentsPrefix()}:runQuery`, { body });
    if (!Array.isArray(payload)) {
      throw this.invalidResponseError('runQuery');
    }

    const documents: FirestoreDocument[] = [];
    for (const entry of payload) {
      const record = asRecord(entry);
      const document = record?.['document'];
      if (document !== null && document !== undefined) {
        documents.push(this.toDocument(document));
      }
    }

    return Object.freeze(documents);
  }

  /** POST /v1/projects/{p}/databases/{d}/documents/{collection}?documentId=... (CreateDocument) */
  public async createDocument(
    collectionPath: string,
    data: Record<string, unknown>,
    documentId?: string,
  ): Promise<FirestoreDocument> {
    assertSafeRelativePath(collectionPath);
    if (documentId !== undefined) {
      assertSafeRelativePath(documentId);
    }

    const suffix = documentId !== undefined ? `?documentId=${encodeURIComponent(documentId)}` : '';
    const url = `${this.documentsPrefix()}/${collectionPath}${suffix}`;
    const payload = await this.sendJson('POST', url, { body: { fields: encodeFields(data) } });
    return this.toDocument(payload);
  }

  /** PATCH /v1/projects/{p}/databases/{d}/documents/{path} (UpdateDocument) */
  public async patchDocument(
    relativePath: string,
    data: Record<string, unknown>,
    options: PatchDocumentOptions = {},
  ): Promise<FirestoreDocument> {
    assertSafeRelativePath(relativePath);

    // Stage 5A: same pre-send safety rules as commitWrites. The PATCH endpoint
    // cannot express field transforms, so the transform list is always empty
    // here (SERVER_TIMESTAMP values are rejected later by the codec itself).
    if (Object.keys(data).length === 0) {
      throw invalidWriteError(
        `patch of "${relativePath}" has no fields; refusing an empty write `
        + '(it would replace the document with nothing).',
      );
    }
    let maskPaths: readonly (readonly string[])[] | undefined;
    let encodedBody: FirestoreFields;
    try {
      maskPaths = options.updateMaskPaths?.map((path) => parseFieldPath(path));
      if (maskPaths !== undefined) {
        validateMaskedWrite(relativePath, data, [], maskPaths);
      }
      encodedBody = encodeFields(data);
    } catch (error: unknown) {
      // Same contract as commitWrites: a caller-side shape problem is reported
      // as a typed client error with requestSent = false, never as a raw codec error.
      if (error instanceof FirestoreRestError) {
        throw error;
      }
      if (error instanceof FirestoreCodecError) {
        throw invalidWriteError(`patch of "${relativePath}": ${error.message}`);
      }
      throw error;
    }

    const params = new URLSearchParams();
    for (const segments of maskPaths ?? []) {
      params.append('updateMask.fieldPaths', encodeFieldPathSegments(segments));
    }
    const precondition = options.precondition ?? 'none';
    if (precondition === 'exists') {
      params.set('currentDocument.exists', 'true');
    } else if (precondition === 'missing') {
      params.set('currentDocument.exists', 'false');
    }
    const query = params.toString();
    const url = `${this.documentUrl(relativePath)}${query.length > 0 ? `?${query}` : ''}`;

    const payload = await this.sendJson('PATCH', url, { body: { fields: encodedBody } });
    return this.toDocument(payload);
  }

  /** POST /v1/projects/{p}/databases/{d}/documents:beginTransaction */
  public async beginTransaction(): Promise<string> {
    const payload = await this.sendJson('POST', `${this.documentsPrefix()}:beginTransaction`, {
      body: {},
    });
    const record = asRecord(payload);
    const transaction = record ? readOptionalString(record, 'transaction') : null;
    if (transaction === null) {
      throw this.invalidResponseError('beginTransaction');
    }
    return transaction;
  }

  /**
   * POST /v1/projects/{p}/databases/{d}/documents:batchGet
   * Reads documents inside a transaction when transactionId is provided.
   * Missing documents are returned as null, keeping the requested order.
   */
  public async batchGetDocuments(
    relativePaths: readonly string[],
    transaction?: string,
  ): Promise<readonly (FirestoreDocument | null)[]> {
    if (relativePaths.length === 0) {
      return Object.freeze([]);
    }

    const resourceNames = relativePaths.map((relativePath) => this.toResourceName(relativePath));
    const body: Record<string, unknown> = { documents: resourceNames };
    if (transaction !== undefined) {
      body['transaction'] = transaction;
    }

    const payload = await this.sendJson('POST', `${this.documentsPrefix()}:batchGet`, { body });
    if (!Array.isArray(payload)) {
      throw this.invalidResponseError('batchGet');
    }

    const foundByName = new Map<string, FirestoreDocument>();
    for (const entry of payload) {
      const record = asRecord(entry);
      const document = record?.['found'];
      if (document !== null && document !== undefined) {
        const decoded = this.toDocument(document);
        foundByName.set(decoded.name, decoded);
      }
    }

    return Object.freeze(resourceNames.map((name) => foundByName.get(name) ?? null));
  }

  /** POST /v1/projects/{p}/databases/{d}/documents:commit */
  public async commitWrites(
    writes: readonly FirestoreWriteRequest[],
    transaction?: string,
  ): Promise<FirestoreCommitResult> {
    const encodedWrites = writes.map((write) => this.buildWrite(write));

    const body: Record<string, unknown> = { writes: encodedWrites };
    if (transaction !== undefined) {
      body['transaction'] = transaction;
    }

    const payload = await this.sendJson('POST', `${this.documentsPrefix()}:commit`, { body });
    const record = asRecord(payload);

    return Object.freeze({
      commitTime: record ? readOptionalString(record, 'commitTime') : null,
      writeCount: encodedWrites.length,
    });
  }

  /**
   * Builds one Firestore REST `Write` object, applying Stage 5A semantics:
   *  - `SERVER_TIMESTAMP` markers become `updateTransforms` (REQUEST_TIME);
   *  - `updateMaskPaths` becomes `updateMask` (validated first);
   *  - `kind: 'update'` without an explicit mask derives one from the data keys
   *    that carry values (partial update = the C5 fix);
   *  - `create`/`upsert` without an explicit mask keep their existing
   *    create/replace semantics;
   *  - unsafe shapes throw BEFORE anything is sent (see `validateMaskedWrite`).
   */
  private buildWrite(write: FirestoreWriteRequest): Record<string, unknown> {
    // Every shape problem below is a CALLER error, not a server error, so it must
    // surface through the client's own error type (reason INVALID_ARGUMENT,
    // requestSent false) instead of escaping as a raw FirestoreCodecError. That
    // keeps one contract for callers: "the request was never sent".
    try {
      return this.buildWriteBody(write);
    } catch (error: unknown) {
      if (error instanceof FirestoreRestError) {
        throw error;
      }
      if (error instanceof FirestoreCodecError) {
        throw invalidWriteError(`write "${write.relativePath}": ${error.message}`);
      }
      throw error;
    }
  }

  private buildWriteBody(write: FirestoreWriteRequest): Record<string, unknown> {
    const extracted = extractServerTimestamps(write.data);
    const fields = extracted.fields;
    const transformPaths = extracted.transformPaths;
    const kind: FirestoreWriteKind = write.kind ?? 'upsert';
    const topLevelKeys = Object.keys(fields);

    if (topLevelKeys.length === 0 && transformPaths.length === 0) {
      throw invalidWriteError(
        `write "${write.relativePath}" has no fields and no server-timestamp transforms; `
        + 'refusing an empty write (it would replace the document with nothing).',
      );
    }

    let maskPaths: readonly (readonly string[])[] | undefined;
    if (write.updateMaskPaths !== undefined) {
      maskPaths = write.updateMaskPaths.map((path) => parseFieldPath(path));
    } else if (kind === 'update') {
      // C5 fix: derive the mask from the data keys that actually carry values.
      // Keys emptied by a server-timestamp extraction are excluded, so a
      // transform-only write never clears existing sibling fields.
      const leafPaths = collectDataLeafPaths(fields);
      maskPaths = topLevelKeys
        .filter((key) => leafPaths.some((leaf) => leaf[0] === key))
        .map((key) => [key]);
    } else if (topLevelKeys.length === 0 && transformPaths.length > 0 && kind === 'upsert') {
      throw invalidWriteError(
        `write "${write.relativePath}" carries only server timestamps: an upsert without an `
        + 'explicit mask would REPLACE the document with nothing. Provide updateMaskPaths '
        + '(use [] for a transform-only update) or use kind: "create" for a new document.',
      );
    }

    if (maskPaths !== undefined) {
      validateMaskedWrite(write.relativePath, fields, transformPaths, maskPaths);
    }

    const wire: Record<string, unknown> = {
      update: {
        name: this.toResourceName(write.relativePath),
        fields: encodeFields(fields),
      },
    };
    if (maskPaths !== undefined) {
      wire['updateMask'] = { fieldPaths: maskPaths.map((segments) => encodeFieldPathSegments(segments)) };
    }
    if (transformPaths.length > 0) {
      wire['updateTransforms'] = transformPaths.map((segments) => ({
        fieldPath: encodeFieldPathSegments(segments),
        setToServerValue: 'REQUEST_TIME',
      }));
    }
    if (kind === 'create') {
      wire['currentDocument'] = { exists: false };
    } else if (kind === 'update') {
      wire['currentDocument'] = { exists: true };
    }
    return wire;
  }

  /** POST /v1/projects/{p}/databases/{d}/documents:rollback */
  public async rollback(transaction: string): Promise<void> {
    await this.sendJson('POST', `${this.documentsPrefix()}:rollback`, { body: { transaction } });
  }

  // --------------------------------------------------------------- internals

  private documentsPrefix(): string {
    return buildFirestoreDocumentsUrlPrefix(this.config);
  }

  private documentUrl(relativePath: string): string {
    assertSafeRelativePath(relativePath);
    return `${this.documentsPrefix()}/${relativePath}`;
  }

  private invalidResponseError(operation: string): FirestoreRestError {
    return new FirestoreRestError({
      reason: 'UNKNOWN',
      httpStatus: 0,
      requestSent: true,
      message: `استجابة Firestore غير متوقعة أثناء تنفيذ ${operation}`,
    });
  }

  /** Fails before any network call when the target is unusable or not local. */
  private assertRequestableTarget(): void {
    if (!isFirestoreConfigured(this.config)) {
      throw new FirestoreRestError({
        reason: 'CONFIGURATION_ERROR',
        httpStatus: 0,
        requestSent: false,
        message: 'إعدادات Firestore غير مكتملة (projectId / databaseId)',
      });
    }

    try {
      assertLocalFirestoreTarget(this.config, this.allowRemoteTarget);
    } catch (error: unknown) {
      if (error instanceof FirestoreConfigError) {
        throw new FirestoreRestError({
          reason: 'CONFIGURATION_ERROR',
          httpStatus: 0,
          requestSent: false,
          message: 'هدف Firestore غير مسموح في هذه المرحلة (يُسمح بالمحاكي المحلي فقط)',
        });
      }
      throw error;
    }
  }

  /** Reads the ID token from the Stage 2 auth layer. It is never logged or returned. */
  private async resolveAccessToken(): Promise<string> {
    let token: string | null;
    try {
      token = await this.getAccessToken();
    } catch {
      token = null;
    }

    if (token === null || token.trim().length === 0) {
      throw new FirestoreRestError({
        reason: 'UNAUTHENTICATED',
        httpStatus: 0,
        requestSent: false,
        message: 'لا توجد جلسة مصادقة صالحة للوصول إلى Firestore',
      });
    }

    return token;
  }

  /** Single HTTP entry point: authentication, timeout, error mapping. */
  private async sendJson(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    options: SendJsonOptions,
  ): Promise<unknown> {
    this.assertRequestableTarget();
    const token = await this.resolveAccessToken();

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    const requestInit: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      // Defence in depth: never follow a 3xx from the Firestore endpoint.
      // A redirect could otherwise re-send the bearer token and/or this
      // request's JSON body to an unintended destination (307/308 preserve
      // method and body). Firestore REST and the emulator never redirect
      // legitimate requests, so rejecting them costs nothing.
      redirect: 'error',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestInit.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, requestInit);
    } catch {
      throw new FirestoreRestError({
        reason: 'NETWORK',
        httpStatus: 0,
        requestSent: true,
        message: 'تعذر الاتصال بخدمة Firestore',
      });
    }

    if (!response.ok) {
      throw await this.toRestError(response);
    }

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    if (text.trim().length === 0) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw this.invalidResponseError(method);
    }
  }

  /** Builds a typed error from a non-2xx Firestore response (tokens are redacted). */
  private async toRestError(response: Response): Promise<FirestoreRestError> {
    let serverMessage: string | null = null;
    let declaredReason: FirestoreRestReason | null = null;

    try {
      const text = await response.text();
      if (text.trim().length > 0) {
        const body = asRecord(JSON.parse(text) as unknown);
        const errorRecord = body ? asRecord(body['error']) : null;
        if (errorRecord !== null) {
          const rawMessage = readOptionalString(errorRecord, 'message');
          serverMessage = rawMessage === null ? null : sanitizeServerMessage(rawMessage);
          const rawStatus = readOptionalString(errorRecord, 'status');
          declaredReason = rawStatus === null ? null : reasonFromStatusName(rawStatus);
        }
      }
    } catch {
      // Non-JSON error body: fall back to the HTTP status only.
    }

    const reason = declaredReason ?? reasonFromHttpStatus(response.status);
    return new FirestoreRestError({
      reason,
      httpStatus: response.status,
      requestSent: true,
      message: this.describeReason(reason),
      serverMessage: serverMessage ?? undefined,
    });
  }

  private describeReason(reason: FirestoreRestReason): string {
    switch (reason) {
      case 'PERMISSION_DENIED':
        return 'رُفض الطلب من قواعد أمان Firestore';
      case 'UNAUTHENTICATED':
        return 'رمز المصادقة غير صالح أو منتهي الصلاحية';
      case 'NOT_FOUND':
        return 'المستند غير موجود في Firestore';
      case 'ALREADY_EXISTS':
        return 'المستند موجود مسبقاً';
      case 'ABORTED':
        return 'أُلغيت المعاملة بسبب تغيّر البيانات أثناء تنفيذها';
      case 'FAILED_PRECONDITION':
        return 'الشروط المسبقة للعملية غير محققة';
      case 'INVALID_ARGUMENT':
        return 'طلب Firestore غير صالح';
      case 'CONFIGURATION_ERROR':
        return 'إعدادات Firestore غير مكتملة';
      case 'NETWORK':
        return 'تعذر الاتصال بخدمة Firestore';
      default:
        return 'فشل الطلب على Firestore';
    }
  }

  /** Decodes a Firestore document payload into a typed, frozen snapshot. */
  private toDocument(payload: unknown): FirestoreDocument {
    const record = asRecord(payload);
    const name = record === null ? null : readOptionalString(record, 'name');
    if (record === null || name === null) {
      throw this.invalidResponseError('document');
    }

    const rawFields = record['fields'];
    const fields = asRecord(rawFields) as unknown as FirestoreFields | null;

    return Object.freeze({
      name,
      relativePath: this.toRelativePath(name),
      createTime: readOptionalString(record, 'createTime'),
      updateTime: readOptionalString(record, 'updateTime'),
      data: decodeFields(fields ?? undefined),
    });
  }

  private toRelativePath(resourceName: string): string {
    const prefix = `projects/${this.config.projectId}/databases/${this.config.databaseId}/documents/`;
    return resourceName.startsWith(prefix) ? resourceName.slice(prefix.length) : resourceName;
  }
}





