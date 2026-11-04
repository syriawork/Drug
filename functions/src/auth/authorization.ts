import { HttpsError } from 'firebase-functions/v2/https';

import {
  parseUserProfile,
  type UserProfile,
  type UserProfileReader,
} from './user-profile';
import {
  withSafeCallableErrors,
  type CallableDiagnostics,
} from '../callable/error-handling';

export interface CallableRequestContext {
  readonly auth?: {
    readonly uid?: unknown;
  } | null;
}

export interface AuthenticatedCaller {
  readonly uid: string;
  readonly profile: UserProfile;
}

export interface AuthorizationService {
  requireApprovedEmployee(request: CallableRequestContext): Promise<AuthenticatedCaller>;
  requireAdministrator(request: CallableRequestContext): Promise<AuthenticatedCaller>;
  requireAssistant(request: CallableRequestContext): Promise<AuthenticatedCaller>;
}

export interface AuthorizationServiceOptions {
  readonly profiles: UserProfileReader;
  readonly diagnostics?: CallableDiagnostics;
}

function authenticatedUid(request: CallableRequestContext): string {
  const uid = request?.auth?.uid;
  if (typeof uid !== 'string' || uid.trim().length === 0) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }
  return uid;
}

export function createAuthorizationService(
  options: AuthorizationServiceOptions,
): AuthorizationService {
  async function loadCaller(request: CallableRequestContext): Promise<AuthenticatedCaller> {
    const uid = authenticatedUid(request);
    const profileData = await options.profiles.read(uid);

    if (profileData === null) {
      throw new HttpsError('not-found', 'The user profile was not found.');
    }

    return Object.freeze({
      uid,
      profile: parseUserProfile(uid, profileData),
    });
  }

  async function authorize(
    operation: string,
    request: CallableRequestContext,
    allowed: (caller: AuthenticatedCaller) => boolean,
  ): Promise<AuthenticatedCaller> {
    return withSafeCallableErrors(operation, async () => {
      const caller = await loadCaller(request);
      if (!allowed(caller)) {
        throw new HttpsError('permission-denied', 'You are not authorized to perform this operation.');
      }
      return caller;
    }, options.diagnostics);
  }

  const isManager = (caller: AuthenticatedCaller): boolean =>
    caller.profile.role === 'admin' || caller.profile.role === 'assistant';

  return Object.freeze({
    requireApprovedEmployee: (request: CallableRequestContext): Promise<AuthenticatedCaller> =>
      authorize('requireApprovedEmployee', request, (caller) => caller.profile.status === 'approved'),
    requireAdministrator: (request: CallableRequestContext): Promise<AuthenticatedCaller> =>
      authorize('requireAdministrator', request, isManager),
    requireAssistant: (request: CallableRequestContext): Promise<AuthenticatedCaller> =>
      authorize('requireAssistant', request, isManager),
  });
}
