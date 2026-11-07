import { isDomainId } from './operations';

export type AuthorizationProfileState = 'missing' | 'malformed' | 'pending' | 'rejected' | 'approved';
export type AuthorizationRole = 'admin' | 'assistant' | 'employee';
export type AuthorizationStatus = 'pending' | 'approved' | 'rejected';
export type FirebaseAuthAccountState = 'enabled' | 'disabled' | 'missing' | 'unavailable';
export type CombinedAuthorizationState =
  | AuthorizationProfileState
  | 'auth-disabled'
  | 'auth-missing'
  | 'auth-unavailable';

export interface AuthorizationProfile {
  readonly uid: string;
  readonly role: AuthorizationRole;
  readonly status: AuthorizationStatus;
}

export interface FirebaseAuthAccountLookup {
  readonly state: FirebaseAuthAccountState;
}

export type AuthorizationProfileResult =
  | { readonly state: 'missing' }
  | { readonly state: 'malformed' }
  | { readonly state: 'pending'; readonly profile: AuthorizationProfile }
  | { readonly state: 'rejected'; readonly profile: AuthorizationProfile }
  | { readonly state: 'approved'; readonly profile: AuthorizationProfile };

export type CombinedAuthorizationResult =
  | { readonly state: 'missing' }
  | { readonly state: 'malformed' }
  | { readonly state: 'pending'; readonly profile: AuthorizationProfile }
  | { readonly state: 'rejected'; readonly profile: AuthorizationProfile }
  | { readonly state: 'auth-disabled'; readonly profile: AuthorizationProfile }
  | { readonly state: 'auth-missing'; readonly profile: AuthorizationProfile }
  | { readonly state: 'auth-unavailable'; readonly profile: AuthorizationProfile }
  | { readonly state: 'approved'; readonly profile: AuthorizationProfile };

const ROLES: ReadonlySet<string> = new Set(['admin', 'assistant', 'employee']);
const STATUSES: ReadonlySet<string> = new Set(['pending', 'approved', 'rejected']);
const AUTH_STATES: ReadonlySet<string> = new Set(['enabled', 'disabled', 'missing', 'unavailable']);

function isAuthorizationRole(value: unknown): value is AuthorizationRole {
  return typeof value === 'string' && ROLES.has(value);
}

function isAuthorizationStatus(value: unknown): value is AuthorizationStatus {
  return typeof value === 'string' && STATUSES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const expected = new Set(fields);
  return !Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !expected.has(key));
}

export function evaluateAuthorizationProfile(
  expectedUid: unknown,
  value: unknown,
): AuthorizationProfileResult {
  if (value === null || value === undefined) {
    return Object.freeze({ state: 'missing' });
  }
  if (!isRecord(value) || !isDomainId(expectedUid)) {
    return Object.freeze({ state: 'malformed' });
  }
  const role = value['role'];
  const status = value['status'];
  if (
    !isDomainId(value['uid'])
    || value['uid'] !== expectedUid
    || !isAuthorizationRole(role)
    || !isAuthorizationStatus(status)
  ) {
    return Object.freeze({ state: 'malformed' });
  }

  const profile: AuthorizationProfile = Object.freeze({ uid: expectedUid, role, status });
  return Object.freeze({ state: status, profile });
}

function parseAuthLookup(value: unknown): FirebaseAuthAccountState {
  if (value === null || value === undefined) {
    return 'unavailable';
  }
  if (!isRecord(value) || !exactFields(value, ['state'])) {
    return 'unavailable';
  }
  const state = value['state'];
  if (typeof state !== 'string' || !AUTH_STATES.has(state)) {
    return 'unavailable';
  }
  return state as FirebaseAuthAccountState;
}

export function evaluateCombinedAuthorization(
  expectedUid: unknown,
  profileValue: unknown,
  authLookupValue: unknown,
): CombinedAuthorizationResult {
  const profileResult = evaluateAuthorizationProfile(expectedUid, profileValue);
  if (profileResult.state === 'missing' || profileResult.state === 'malformed') {
    return profileResult;
  }
  if (profileResult.state === 'pending' || profileResult.state === 'rejected') {
    return profileResult;
  }

  const authState = parseAuthLookup(authLookupValue);
  if (authState === 'enabled') {
    return Object.freeze({ state: 'approved', profile: profileResult.profile });
  }
  if (authState === 'disabled') {
    return Object.freeze({ state: 'auth-disabled', profile: profileResult.profile });
  }
  if (authState === 'missing') {
    return Object.freeze({ state: 'auth-missing', profile: profileResult.profile });
  }
  return Object.freeze({ state: 'auth-unavailable', profile: profileResult.profile });
}
