import {
  type FirebaseAuthConfig,
  buildSignInWithPasswordUrl,
  buildTokenRefreshUrl,
  validateFirebaseAuthConfig,
} from '../config/firebase-config';

/**
 * Main-Process Firebase Authentication REST Service.
 *
 * Security & architectural guarantees:
 *  1. Only standard REST endpoints are used (fetch API built into Node.js 20+).
 *  2. No Firebase Web SDK, Admin SDK, or Service Account credentials.
 *  3. Sensitive tokens (idToken, refreshToken) live ONLY in the private state of this service.
 *  4. toSafeAuthState() strips all tokens and returns strictly non-sensitive fields to callers.
 *  5. Error parsing sanitizes raw HTTP responses and provides safe application error codes.
 */

export interface InternalTokenSession {
  readonly idToken: string;
  readonly refreshToken: string;
  readonly localId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly expiresInSeconds: number;
  readonly expiresAtMillis: number;
}

export interface SignInWithPasswordSuccessResponse {
  idToken: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  registered?: boolean;
}

export interface RefreshTokenSuccessResponse {
  expires_in: string;
  token_type: string;
  refresh_token: string;
  id_token: string;
  user_id: string;
  project_id: string;
}

export interface FirebaseRestErrorResponse {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{
      message?: string;
      domain?: string;
      reason?: string;
    }>;
  };
}

export class AuthenticationError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

/** Translates raw Firebase Identity Toolkit error messages to safe user-friendly messages. */
export function mapFirebaseError(rawMessage?: string): { code: string; message: string } {
  if (!rawMessage) {
    return {
      code: 'AUTH_UNKNOWN_ERROR',
      message: 'حدث خطأ غير متوقع أثناء المصادقة',
    };
  }

  // Firebase error strings often take the form "EMAIL_NOT_FOUND : ..." or "INVALID_LOGIN_CREDENTIALS"
  const normalized = rawMessage.split(':')[0]?.trim() || rawMessage.trim();

  switch (normalized) {
    case 'EMAIL_NOT_FOUND':
    case 'INVALID_PASSWORD':
    case 'INVALID_LOGIN_CREDENTIALS':
      return {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      };
    case 'USER_DISABLED':
      return {
        code: 'AUTH_USER_DISABLED',
        message: 'تم تعطيل هذا الحساب من قِبل مسؤول النظام',
      };
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
      return {
        code: 'AUTH_TOO_MANY_ATTEMPTS',
        message: 'تم تجاوز عدد المحاولات المسموح بها، يُرجى المحاولة لاحقاً',
      };
    case 'TOKEN_EXPIRED':
    case 'USER_NOT_FOUND':
    case 'INVALID_REFRESH_TOKEN':
      return {
        code: 'AUTH_SESSION_EXPIRED',
        message: 'انتهت صلاحية جلسة تسجيل الدخول، يُرجى إعادة تسجيل الدخول',
      };
    case 'OPERATION_NOT_ALLOWED':
      return {
        code: 'AUTH_OPERATION_NOT_ALLOWED',
        message: 'خدمة تسجيل الدخول بالبريد الإلكتروني غير مفعّلة في المشروع',
      };
    case 'MISSING_PASSWORD':
    case 'INVALID_EMAIL':
      return {
        code: 'AUTH_INVALID_INPUT',
        message: 'صيغة البريد الإلكتروني أو كلمة المرور غير صالحة',
      };
    default:
      return {
        code: 'AUTH_FAILED',
        message: 'تعذر إتمام عملية تسجيل الدخول، يُرجى التحقق من الاتصال والمحاولة ثانية',
      };
  }
}

/** HTTP client type allowing dependency injection in unit tests without network. */
export type HttpFetchFunction = typeof fetch;

export interface FirebaseAuthOptions {
  readonly requestTimeoutMs?: number;
  readonly createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}

export class FirebaseAuthService {
  private readonly config: FirebaseAuthConfig;
  private readonly fetchImpl: HttpFetchFunction;
  private readonly requestTimeoutMs: number;
  private readonly createTimeoutSignal: (timeoutMs: number) => AbortSignal;
  private session: InternalTokenSession | null = null;
  private sessionGeneration = 0;
  private signInGeneration = 0;
  private refreshInFlight: {
    readonly session: InternalTokenSession;
    readonly generation: number;
    readonly promise: Promise<SafeAuthState>;
  } | null = null;

  public constructor(
    config: FirebaseAuthConfig,
    fetchImpl: HttpFetchFunction = globalThis.fetch,
    options: FirebaseAuthOptions = {},
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    this.createTimeoutSignal = options.createTimeoutSignal ?? ((timeoutMs) => AbortSignal.timeout(timeoutMs));
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new RangeError('Firebase Auth request timeout must be a positive finite number');
    }
  }

  private async fetchJsonWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<{ readonly response: Response; readonly body: unknown }> {
    const signal = this.createTimeoutSignal(this.requestTimeoutMs);
    let rejectTimeout!: (error: AuthenticationError) => void;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const onAbort = (): void => {
      rejectTimeout(new AuthenticationError(
        'AUTH_TIMEOUT',
        'انتهت مهلة الاتصال بخدمة المصادقة، يُرجى المحاولة مرة أخرى',
      ));
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      return await Promise.race([
        (async () => {
          const response = await this.fetchImpl(url, { ...init, signal });
          let body: unknown;
          if (response.ok) {
            body = await response.json();
          } else {
            try {
              body = await response.json();
            } catch {
              body = undefined;
            }
          }
          return { response, body };
        })(),
        timeout,
      ]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Gets the current safe authentication state (safe for Renderer via IPC). */
  public getSafeState(): SafeAuthState {
    if (!this.session) {
      return Object.freeze({
        authenticated: false,
        uid: null,
        email: null,
        emailVerified: false,
        expirationTimeIso: null,
      });
    }

    return Object.freeze({
      authenticated: true,
      uid: this.session.localId,
      email: this.session.email,
      emailVerified: this.session.emailVerified,
      expirationTimeIso: new Date(this.session.expiresAtMillis).toISOString(),
    });
  }

  /**
   * Internal getter for valid ID token used strictly within Main Process
   * (e.g. for upcoming Firestore REST requests in Stage 3). Automatically refreshes if expired.
   */
  public async getValidIdToken(): Promise<string | null> {
    const session = this.session;
    const generation = this.sessionGeneration;
    if (!session) {
      return null;
    }

    // Refresh if within 60 seconds of expiration
    if (session.expiresAtMillis - Date.now() <= 60000) {
      try {
        await this.refreshIdToken();
      } catch {
        if (this.session !== session || this.sessionGeneration !== generation) {
          return null;
        }
        // If refresh fails for the session that requested it, clear that session.
        this.signOut();
        return null;
      }
    }

    if (this.sessionGeneration !== generation) {
      return null;
    }
    return this.session?.idToken ?? null;
  }

  /**
   * Signs in using email and password via Firebase Auth REST API.
   * Stores ID token and refresh token in memory only.
   */
  public async signInWithEmailAndPassword(credentials: SignInCredentials): Promise<SafeAuthState> {
    validateFirebaseAuthConfig(this.config);

    if (!credentials.email || !credentials.email.trim()) {
      throw new AuthenticationError('AUTH_INVALID_INPUT', 'يجب إدخال البريد الإلكتروني');
    }
    if (!credentials.password) {
      throw new AuthenticationError('AUTH_INVALID_INPUT', 'يجب إدخال كلمة المرور');
    }
    const signInGeneration = ++this.signInGeneration;

    const url = buildSignInWithPasswordUrl(this.config);
    const body = {
      email: credentials.email.trim(),
      password: credentials.password,
      returnSecureToken: true,
    };

    let response: Response;
    let responseBody: unknown;
    try {
      const result = await this.fetchJsonWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
      });
      response = result.response;
      responseBody = result.body;
    } catch (networkError: unknown) {
      if (networkError instanceof AuthenticationError && networkError.code === 'AUTH_TIMEOUT') {
        throw networkError;
      }
      throw new AuthenticationError(
        'AUTH_NETWORK_ERROR',
        'تعذر الاتصال بخدمة المصادقة، تأكد من توفر الاتصال بالشبكة',
      );
    }

    if (!response.ok) {
      const rawErrorMessage = (responseBody as FirebaseRestErrorResponse | undefined)?.error?.message;
      const mapped = mapFirebaseError(rawErrorMessage);
      // Ensure state is cleared on failure
      if (signInGeneration === this.signInGeneration) {
        this.session = null;
        this.sessionGeneration += 1;
      }
      throw new AuthenticationError(mapped.code, mapped.message);
    }

    const data = responseBody as SignInWithPasswordSuccessResponse;
    if (signInGeneration !== this.signInGeneration) {
      return this.getSafeState();
    }
    const expiresInSeconds = Number.parseInt(data.expiresIn, 10) || 3600;
    const expiresAtMillis = Date.now() + expiresInSeconds * 1000;

    this.sessionGeneration += 1;
    this.session = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      localId: data.localId,
      email: data.email,
      emailVerified: false,
      expiresInSeconds,
      expiresAtMillis,
    };

    return this.getSafeState();
  }

  /**
   * Refreshes the ID token using the current refresh token.
   * Clears session if token refresh fails.
   */
  public async refreshIdToken(): Promise<SafeAuthState> {
    validateFirebaseAuthConfig(this.config);

    const session = this.session;
    if (!session || !session.refreshToken) {
      throw new AuthenticationError('AUTH_NOT_AUTHENTICATED', 'لا توجد جلسة نشطة لتحديثها');
    }
    const generation = this.sessionGeneration;
    const activeRefresh = this.refreshInFlight;
    if (activeRefresh?.session === session && activeRefresh.generation === generation) {
      return activeRefresh.promise;
    }

    const url = buildTokenRefreshUrl(this.config);
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', session.refreshToken);

    const promise = this.performTokenRefresh(url, params, session, generation);
    this.refreshInFlight = { session, generation, promise };
    try {
      return await promise;
    } finally {
      if (this.refreshInFlight?.promise === promise) {
        this.refreshInFlight = null;
      }
    }
  }

  private async performTokenRefresh(
    url: string,
    params: URLSearchParams,
    session: InternalTokenSession,
    generation: number,
  ): Promise<SafeAuthState> {
    let response: Response;
    let responseBody: unknown;
    try {
      const result = await this.fetchJsonWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        redirect: 'error',
      });
      response = result.response;
      responseBody = result.body;
    } catch (error: unknown) {
      if (error instanceof AuthenticationError && error.code === 'AUTH_TIMEOUT') {
        throw error;
      }
      throw new AuthenticationError(
        'AUTH_NETWORK_ERROR',
        'تعذر الاتصال لتحديث رمز الجلسة',
      );
    }

    if (!response.ok) {
      const rawErrorMessage = (responseBody as FirebaseRestErrorResponse | undefined)?.error?.message;
      if (this.session === session && this.sessionGeneration === generation) {
        this.session = null;
        this.sessionGeneration += 1;
      }
      const mapped = mapFirebaseError(rawErrorMessage || 'TOKEN_EXPIRED');
      throw new AuthenticationError(mapped.code, mapped.message);
    }

    const data = responseBody as RefreshTokenSuccessResponse;
    if (this.session !== session || this.sessionGeneration !== generation) {
      return this.getSafeState();
    }
    const expiresInSeconds = Number.parseInt(data.expires_in, 10) || 3600;
    const expiresAtMillis = Date.now() + expiresInSeconds * 1000;

    this.session = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      localId: data.user_id,
      email: session.email,
      emailVerified: session.emailVerified,
      expiresInSeconds,
      expiresAtMillis,
    };

    return this.getSafeState();
  }

  /** Signs out: clears all in-memory session tokens and state. */
  public signOut(): void {
    this.signInGeneration += 1;
    this.sessionGeneration += 1;
    this.session = null;
  }
}