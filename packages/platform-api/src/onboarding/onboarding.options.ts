// =============================================================================
// `OnboardingModule.forRoot()` options (issue #745, PP-9.3)
// =============================================================================

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { ONBOARDING_ADMIN_PERMISSION } from '@marinoscar/platform-contract/onboarding';

/**
 * Injection token of the {@link ResolvedOnboardingModuleOptions}.
 *
 * @stability experimental
 */
export const ONBOARDING_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/onboarding/OPTIONS');

/**
 * What an app passes to `OnboardingModule.forRoot()`. No option is an
 * environment variable of its own.
 *
 * @stability experimental
 */
export interface OnboardingModuleOptions {
  /**
   * The permission that adds the admin block to `GET /api/onboarding` and
   * gates `GET /api/admin/onboarding/metrics`. Default `system_settings:read`
   * (the Doctor's, whose report the admin steps reuse). Must be a permission
   * the app's RBAC grants.
   */
  adminPermission?: string;
  /** The variable (read through `ConfigService`) holding the bootstrap administrator's address. Default `'INITIAL_ADMIN_EMAIL'`. */
  initialAdminEmailEnv?: string;
  /** The modules binding the host ports (`ONBOARDING_DATA`, optionally `ONBOARDING_FEATURES`). */
  imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * The options with every default applied.
 *
 * @stability experimental
 */
export interface ResolvedOnboardingModuleOptions {
  /** See {@link OnboardingModuleOptions.adminPermission}. */
  readonly adminPermission: string;
  /** See {@link OnboardingModuleOptions.initialAdminEmailEnv}. */
  readonly initialAdminEmailEnv: string;
  /** See {@link OnboardingModuleOptions.imports}. */
  readonly imports: NonNullable<OnboardingModuleOptions['imports']>;
}

/**
 * The defaults.
 *
 * @stability experimental
 */
export const DEFAULT_ONBOARDING_OPTIONS: ResolvedOnboardingModuleOptions = Object.freeze({
  adminPermission: ONBOARDING_ADMIN_PERMISSION,
  initialAdminEmailEnv: 'INITIAL_ADMIN_EMAIL',
  imports: [],
});

/**
 * Validates the options and applies the defaults.
 *
 * @param options - the app's options.
 * @returns the resolved options.
 * @throws Error when an option is malformed.
 *
 * @stability experimental
 */
export function resolveOnboardingModuleOptions(options: OnboardingModuleOptions = {}): ResolvedOnboardingModuleOptions {
  const adminPermission = options.adminPermission ?? DEFAULT_ONBOARDING_OPTIONS.adminPermission;
  if (typeof adminPermission !== 'string' || adminPermission.trim() === '') {
    throw new Error('OnboardingModule.forRoot: `adminPermission` must be a non-empty permission string.');
  }
  const initialAdminEmailEnv = options.initialAdminEmailEnv ?? DEFAULT_ONBOARDING_OPTIONS.initialAdminEmailEnv;
  if (typeof initialAdminEmailEnv !== 'string' || initialAdminEmailEnv.trim() === '') {
    throw new Error('OnboardingModule.forRoot: `initialAdminEmailEnv` must be a non-empty variable name.');
  }
  return Object.freeze({ adminPermission, initialAdminEmailEnv, imports: [...(options.imports ?? [])] });
}
