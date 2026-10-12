import { join } from 'node:path';

/**
 * Application configuration for the foundation stage.
 * Pure data + validation only: it has no Electron dependency so it can be
 * unit tested directly.
 */

export class AppConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AppConfigError';
  }
}

export interface WindowBounds {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

export interface AppConfig {
  readonly appName: string;
  readonly windowTitle: string;
  readonly windowBounds: WindowBounds;
  readonly indexPath: string;
  readonly isDevelopment: boolean;
}

export interface AppConfigDefaults {
  readonly appName: string;
  readonly windowTitle: string;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

/** Default values for the manager window (Arabic RTL UI). */
export const APP_DEFAULTS: AppConfigDefaults = Object.freeze({
  appName: 'drug-manager',
  windowTitle: 'مدير نظام الطلبات والمخزون',
  width: 1100,
  height: 720,
  minWidth: 900,
  minHeight: 600,
});

export interface CreateAppConfigOptions {
  /** Absolute path of the project root (Electron: app.getAppPath()). */
  readonly projectRoot: string;
  /** True while running unpackaged from source (electron .). */
  readonly isDevelopment: boolean;
  readonly defaults: AppConfigDefaults;
}

/** Validates window bounds and throws AppConfigError when a value is unusable. */
export function validateWindowBounds(bounds: WindowBounds): void {
  const numericEntries: readonly (readonly [string, number])[] = [
    ['width', bounds.width],
    ['height', bounds.height],
    ['minWidth', bounds.minWidth],
    ['minHeight', bounds.minHeight],
  ];

  for (const [name, value] of numericEntries) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new AppConfigError(`windowBounds.${name} must be a positive integer, received: ${String(value)}`);
    }
  }

  if (bounds.width < bounds.minWidth) {
    throw new AppConfigError(
      `windowBounds.width (${bounds.width}) must be >= windowBounds.minWidth (${bounds.minWidth})`,
    );
  }

  if (bounds.height < bounds.minHeight) {
    throw new AppConfigError(
      `windowBounds.height (${bounds.height}) must be >= windowBounds.minHeight (${bounds.minHeight})`,
    );
  }
}

/** Validates the text fields of the application configuration. */
export function validateAppConfig(config: AppConfig): void {
  if (config.appName.trim().length === 0) {
    throw new AppConfigError('appName must not be empty');
  }
  if (config.windowTitle.trim().length === 0) {
    throw new AppConfigError('windowTitle must not be empty');
  }
  if (config.indexPath.trim().length === 0) {
    throw new AppConfigError('indexPath must not be empty');
  }
  validateWindowBounds(config.windowBounds);
}

/** Absolute path of the compiled renderer entry point. */
export function resolveRendererIndexPath(projectRoot: string): string {
  if (projectRoot.trim().length === 0) {
    throw new AppConfigError('projectRoot must not be empty');
  }
  return join(projectRoot, 'dist', 'renderer', 'index.html');
}

/** Builds the validated application configuration. */
export function createAppConfig(options: CreateAppConfigOptions): AppConfig {
  const { defaults } = options;
  const config: AppConfig = {
    appName: defaults.appName,
    windowTitle: defaults.windowTitle,
    windowBounds: {
      width: defaults.width,
      height: defaults.height,
      minWidth: defaults.minWidth,
      minHeight: defaults.minHeight,
    },
    indexPath: resolveRendererIndexPath(options.projectRoot),
    isDevelopment: options.isDevelopment,
  };

  validateAppConfig(config);
  return Object.freeze(config);
}
