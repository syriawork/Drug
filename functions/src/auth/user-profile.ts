import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export type UserRole = 'admin' | 'assistant' | 'employee';
export type UserStatus = 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  readonly uid: string;
  readonly role: UserRole;
  readonly status: UserStatus;
}

export interface UserProfileReader {
  read(uid: string): Promise<unknown | null>;
}

interface UserProfileDocumentSnapshot {
  readonly exists: boolean;
  data(): unknown;
}

interface UserProfileDocumentReference {
  get(): Promise<UserProfileDocumentSnapshot>;
}

interface UserProfileCollection {
  doc(uid: string): UserProfileDocumentReference;
}

export interface UserProfileFirestore {
  collection(name: string): UserProfileCollection;
}

const USER_ROLES: ReadonlySet<string> = new Set(['admin', 'assistant', 'employee']);
const USER_STATUSES: ReadonlySet<string> = new Set(['pending', 'approved', 'rejected']);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.has(value);
}

function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && USER_STATUSES.has(value);
}

export function createAdminUserProfileReader(
  firestore?: UserProfileFirestore,
): UserProfileReader {
  return {
    async read(uid: string): Promise<unknown | null> {
      const database = firestore ?? getFirestore();
      const snapshot = await database.collection('users').doc(uid).get();
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
  };
}

export function parseUserProfile(uid: string, value: unknown): UserProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpsError('failed-precondition', 'The user profile is invalid.');
  }

  const profile = value as Record<string, unknown>;
  if (
    profile['uid'] !== uid
    || !isUserRole(profile['role'])
    || !isUserStatus(profile['status'])
  ) {
    throw new HttpsError('failed-precondition', 'The user profile is invalid.');
  }

  return Object.freeze({
    uid,
    role: profile['role'],
    status: profile['status'],
  });
}
