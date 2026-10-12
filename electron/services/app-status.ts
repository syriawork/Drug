import { containsArabicCharacters } from '../util/text';

/**
 * Application status service (foundation stage).
 *
 * This is deliberately the ONLY thing the main process reports to the renderer
 * right now. It contains no Firebase, no Firestore and no business logic, and
 * it is framework-free so it can be unit tested without Electron.
 */

export const APP_STATUS_HEADING = 'حالة التطبيق';
export const APP_STATUS_LABEL = 'يعمل';

export class AppStatusError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AppStatusError';
  }
}

export interface AppStatusDependencies {
  readonly appName: string;
  readonly version: string;
  readonly electronVersion: string;
  readonly nodeVersion: string;
  readonly locale: string;
  readonly rtl: boolean;
  readonly startedAt: Date;
}

/** Builds the immutable status payload sent to the renderer through IPC. */
export function createAppStatusPayload(dependencies: AppStatusDependencies): AppStatusPayload {
  const { appName, version, electronVersion, nodeVersion, locale, rtl, startedAt } = dependencies;

  const requiredText: readonly (readonly [string, string])[] = [
    ['appName', appName],
    ['version', version],
    ['electronVersion', electronVersion],
    ['nodeVersion', nodeVersion],
    ['locale', locale],
  ];

  for (const [fieldName, value] of requiredText) {
    if (value.trim().length === 0) {
      throw new AppStatusError(`${fieldName} must not be empty`);
    }
  }

  if (Number.isNaN(startedAt.getTime())) {
    throw new AppStatusError('startedAt must be a valid Date');
  }

  const payload: AppStatusPayload = {
    state: 'ready',
    heading: APP_STATUS_HEADING,
    label: APP_STATUS_LABEL,
    appName,
    version,
    electronVersion,
    nodeVersion,
    locale,
    rtl,
    startedAtIso: startedAt.toISOString(),
  };

  if (!containsArabicCharacters(`${payload.heading}${payload.label}`)) {
    throw new AppStatusError('status heading/label must contain Arabic characters');
  }

  return Object.freeze(payload);
}

/**
 * Returns a provider that always answers with the same payload snapshot
 * (computed once at start-up).
 */
export function createAppStatusProvider(dependencies: AppStatusDependencies): () => AppStatusPayload {
  const payload = createAppStatusPayload(dependencies);
  return () => payload;
}
