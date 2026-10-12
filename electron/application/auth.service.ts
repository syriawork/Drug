/**
 * Stage 7 - the authentication use cases.
 *
 * This service is the ONLY place the renderer-facing authentication state is
 * assembled, and it deliberately knows nothing about Firestore wire format,
 * nothing about Electron and nothing about roles as an authorization concept.
 *
 * THE SESSION LIVES HERE, IN MAIN
 * `AuthenticationSession` is the Stage 2 service, which holds the ID token, the
 * refresh token and the expiry in private state. The application layer receives
 * it through a narrow port that exposes three methods and no token getter, so a
 * future refactor cannot reach `idToken` from up here even by accident. The
 * renderer receives a `SafeAuthState`, which by construction has no token field.
 *
 * DISPLAY NAME AND ROLE ARE ESTABLISHED BY THE BACKEND, NEVER GUESSED
 * Both come from ONE read of the signed-in user's OWN `users/{uid}` profile,
 * performed with the signed-in user's own token - a read firestore.rules grants
 * the owner. They are therefore facts the authenticated backend already
 * established, not claims the client invented. `displayName` is never derived
 * from the email address, and `role` is never accepted from the renderer.
 *
 * ROLE IS ADVISORY, AND THIS IS THE PART THAT MATTERS
 * `role` is a UI affordance: it lets the manager screen hide a control the user
 * would be refused anyway. It is NOT an authorization decision. This service
 * performs no role check, and neither does anything else in the application
 * layer: every real decision is made by firestore.rules on the server and comes
 * back as a 403. A local check that said "yes" would grant nothing, and one
 * that said "no" would be a guess about a server the client cannot see.
 *
 * A PROFILE READ THAT FAILS DOES NOT FAIL SIGN-IN
 * Authentication and profile enrichment are different questions. If the profile
 * read is refused, missing or offline, sign-in still succeeds and the two
 * optional fields stay `null`; the UI simply cannot personalise. The
 * alternative - refusing to sign a user in because a display name was
 * unreadable - would conflate two unrelated failures and lock people out.
 */

import type { User } from '../domain/models';
import { AuthenticationError } from '../services/firebase-auth';
import { APPLICATION_ERROR_MESSAGES, ApplicationError } from './application-error';
import { applicationFailureFrom, applicationSuccess, isApplicationFailure } from './application-result';

/**
 * The narrow port onto the Main-process session owner.
 *
 * `FirebaseAuthService` satisfies it structurally, so the production wiring
 * needs no adapter - but note what is ABSENT: there is no `getIdToken`, no
 * `getRefreshToken` and no `getSession`. The application layer is given no way
 * to obtain a token even if a future use case were written that tried.
 */
export interface AuthenticationSession {
  getSafeState(): SafeAuthState;
  signInWithEmailAndPassword(credentials: SignInCredentials): Promise<SafeAuthState>;
  signOut(): void;
}

/** The narrow port used to read the signed-in user's OWN profile. */
export interface OwnProfileReader {
  getUser(uid: string): Promise<User | null>;
}

export interface AuthApplicationServiceOptions {
  readonly session: AuthenticationSession;
  readonly profiles: OwnProfileReader;
  /** Diagnostics sink for the Main-process log. Never sees renderer input. */
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}

/** Rejects renderer input that is not a well-formed credential pair. */
function isSignInCredentials(value: unknown): value is SignInCredentials {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['email'] === 'string' && typeof candidate['password'] === 'string';
}

export class AuthApplicationService {
  private readonly session: AuthenticationSession;
  private readonly profiles: OwnProfileReader;
  private readonly onDiagnostic: ((message: string) => void) | undefined;

  /** Advisory only; cleared on sign-out so it can never outlive the session. */
  private displayName: string | null = null;
  private role: UserRoleView | null = null;

  public constructor(options: AuthApplicationServiceOptions) {
    this.session = options.session;
    this.profiles = options.profiles;
    this.onDiagnostic = options.onDiagnostic;
  }

  /**
   * The safe authentication state. Performs NO I/O: it reads the Main-process
   * session and the advisory profile cache, so it stays usable before sign-in
   * and while offline.
   */
  public getState(): SafeAuthState {
    const state = this.session.getSafeState();
    return Object.freeze({
      authenticated: state.authenticated,
      uid: state.uid,
      email: state.email,
      emailVerified: state.emailVerified,
      expirationTimeIso: state.expirationTimeIso,
      displayName: this.displayName,
      role: this.role,
    });
  }

  /**
   * Signs in and returns the Stage 3 `SignInResult` shape unchanged.
   *
   * The existing contract is preserved deliberately: the Stage 2 service already
   * produces a sanitised, user-facing Arabic message and a stable code for every
   * credential failure, so that wording survives to the UI instead of being
   * flattened into one generic sentence. A `SignInResult` reports failure in its
   * own `error` field rather than by throwing, which is what keeps an internal
   * message from ever reaching the renderer as a rejected `invoke`.
   */
  public async signIn(credentials: unknown): Promise<SignInResult> {
    if (!isSignInCredentials(credentials)) {
      return {
        success: false,
        authState: this.getState(),
        error: { code: 'AUTH_INVALID_INPUT', message: 'بيانات غير صالحة' },
      };
    }

    try {
      await this.session.signInWithEmailAndPassword(credentials);
    } catch (error: unknown) {
      this.clearProfile();
      if (error instanceof AuthenticationError) {
        return {
          success: false,
          authState: this.getState(),
          error: { code: error.code, message: error.message },
        };
      }
      // An unexpected failure still must not throw across IPC: it is classified
      // into the Stage 7 taxonomy first, and only the code is reported. The
      // branch is a runtime guard, not a type-level one, so the success arm has
      // to be excluded explicitly.
      const classified = applicationFailureFrom(error, this.onDiagnostic);
      if (isApplicationFailure(classified)) {
        return {
          success: false,
          authState: this.getState(),
          error: { code: classified.error.code, message: classified.error.message },
        };
      }
      return {
        success: false,
        authState: this.getState(),
        error: { code: 'AUTH_FAILED', message: APPLICATION_ERROR_MESSAGES.AUTHENTICATION_FAILED },
      };
    }

    await this.loadOwnProfile();
    return { success: true, authState: this.getState() };
  }

  /**
   * Signs out. `FirebaseAuthService.signOut` drops the ID token, the refresh
   * token and the expiry from the Main process, so nothing survives to be
   * replayed; the advisory profile is dropped here for the same reason.
   */
  public signOut(): void {
    this.session.signOut();
    this.clearProfile();
  }

  private clearProfile(): void {
    this.displayName = null;
    this.role = null;
  }

  /**
   * Best-effort read of the signed-in user's own profile.
   *
   * Failures are logged and swallowed: authentication already succeeded, and a
   * missing display name is a cosmetic problem, not an authorization one. The
   * catch is deliberately broad because this read may legitimately fail with
   * NOT_FOUND (no profile document) or a transport error.
   */
  private async loadOwnProfile(): Promise<void> {
    const uid = this.session.getSafeState().uid;
    if (uid === null) {
      this.clearProfile();
      return;
    }

    try {
      const profile = await this.profiles.getUser(uid);
      this.displayName = profile === null ? null : profile.name;
      this.role = profile === null ? null : profile.role;
    } catch (error: unknown) {
      this.clearProfile();
      applicationFailureFrom(error, this.onDiagnostic);
    }
  }
}

/**
 * Narrows a safe auth state to a usable uid, or refuses with a classified error.
 *
 * This is a SESSION-PRESENCE check, not an authorization decision. It answers
 * "is anybody signed in at all", which is a fact this process already knows, and
 * it avoids a pointless network round trip. It grants nothing: when a session
 * does exist, every repository call still carries that user's real token and
 * firestore.rules still decides what comes back.
 */
export function requireAuthenticatedUid(state: SafeAuthState): ApplicationResult<string> {
  if (!state.authenticated || state.uid === null || state.uid.length === 0) {
    return applicationFailureFrom<string>(
      new ApplicationError('AUTHENTICATION_FAILED', { retryable: false, diagnostic: 'no Main-process session' }),
    );
  }
  return applicationSuccess(state.uid);
}
