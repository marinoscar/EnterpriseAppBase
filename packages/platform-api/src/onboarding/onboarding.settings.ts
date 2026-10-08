// =============================================================================
// The `onboarding` user-settings namespace (issue #745, PP-9.3)
// =============================================================================
//
// The ONLY stored onboarding state: UI facts (`welcomeSeenAt`,
// `checklistDismissedAt`, `adminDismissedAt`) and the user's `skipped` step
// ids. No step's completion is ever stored: a stored flag lies after a key
// rotation, a derived status cannot drift.
//
// Written through the existing `PATCH /api/user-settings` (with `If-Match`):
// a shallow merge where an explicit `null` clears a key (EvoPath's
// `mergeOnboarding`). `skipped` accepts only ids of registered, skippable
// steps (a 400 otherwise); ids that stopped qualifying are dropped on read
// and on the next write rather than failing either.
//
// The namespace is `.strict()`; an app adds fields (EvoPath's `goal`) with
// `extendOnboardingSettings`, which folds into this declaration through the
// settings slice's own extension mechanism, so it stays strict.
// =============================================================================

import { BadRequestException } from '@nestjs/common';
import {
  ONBOARDING_SETTINGS_KEY,
  onboardingSettingsPatchSchema,
  onboardingSettingsSchema,
  type OnboardingSettings,
  type OnboardingSettingsPatch,
  type OnboardingState,
} from '@marinoscar/platform-contract/onboarding';
import { z } from 'zod';

import {
  userSettingsNamespaceRegistry,
  type UserSettingsNamespace,
  type UserSettingsNamespaceExtension,
} from '../settings/index';
import { onboardingStepRegistry } from './onboarding.registries';

const PLATFORM_FIELDS = ['welcomeSeenAt', 'checklistDismissedAt', 'adminDismissedAt', 'skipped'] as const;

/**
 * Whether `id` names a registered step the user may skip.
 *
 * @param id - a step id.
 * @returns `true` for a registered, skippable step.
 *
 * @stability experimental
 */
export function isSkippableStepId(id: string): boolean {
  return onboardingStepRegistry.get(id)?.skippable === true;
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * The `onboarding` merge (JSON Merge Patch, shallow): `undefined` keeps the
 * stored value, `null` clears the namespace; inside it, a provided field
 * replaces, an explicit `null` deletes it. A `skipped` id that is not a
 * registered, skippable step is a 400.
 *
 * @param current - the stored namespace.
 * @param patch - the parsed PATCH branch.
 * @returns the merged namespace, or `undefined` when empty.
 * @throws BadRequestException when `skipped` names an id that cannot be skipped.
 *
 * @stability experimental
 */
export function mergeOnboardingSettings(
  current: OnboardingSettings | undefined,
  patch: OnboardingSettingsPatch | null | undefined,
): OnboardingSettings | undefined {
  if (patch === undefined) return current;
  if (patch === null) return undefined;

  const merged: Record<string, unknown> = {};
  for (const field of PLATFORM_FIELDS) {
    if (current?.[field] !== undefined) merged[field] = current[field];
  }
  if (Array.isArray(merged['skipped'])) {
    merged['skipped'] = (merged['skipped'] as string[]).filter(isSkippableStepId);
  }

  for (const field of PLATFORM_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null) {
      delete merged[field];
      continue;
    }
    if (field === 'skipped') {
      const refused = (value as string[]).filter((id) => !isSkippableStepId(id));
      if (refused.length > 0) {
        throw new BadRequestException(
          `onboarding.skipped may hold only registered, skippable step ids; refused: ${refused.join(', ')}`,
        );
      }
      merged[field] = dedupe(value as string[]);
      continue;
    }
    merged[field] = value;
  }

  if (Array.isArray(merged['skipped']) && (merged['skipped'] as string[]).length === 0) delete merged['skipped'];
  return Object.keys(merged).length > 0 ? (merged as OnboardingSettings) : undefined;
}

/**
 * The platform's `onboarding` user namespace. The app registers it in its
 * user manifest (appended after the namespaces it already has).
 *
 * @stability experimental
 */
export const ONBOARDING_USER_SETTINGS = {
  /** The namespace key. */
  key: ONBOARDING_SETTINGS_KEY,
  /** What it holds. */
  description:
    'First-run onboarding UI state: when the welcome was seen, when a checklist was dismissed, and which skippable steps were skipped. Never step completion.',
  /** The stored shape (strict). */
  schema: onboardingSettingsSchema,
  /** The PATCH shape (`null` clears a field). */
  patchSchema: onboardingSettingsPatchSchema,
  /** See {@link mergeOnboardingSettings}. */
  merge: mergeOnboardingSettings,
} satisfies UserSettingsNamespace<'onboarding', OnboardingSettings, OnboardingSettingsPatch>;

declare module '../settings/registry/user-settings-namespace' {
  interface UserSettingsNamespaces {
    /** First-run onboarding UI state (#745). Absent: never seen, never dismissed, nothing skipped. */
    onboarding: OnboardingSettings;
  }
  interface UserSettingsNamespaceDeclarations {
    /** The `onboarding` declaration. */
    onboarding: typeof ONBOARDING_USER_SETTINGS;
  }
}

/**
 * Fields an app adds to the stored `onboarding` namespace (EvoPath's `goal`),
 * as a settings extension. List the result in the app's user-settings
 * extensions (`APP_USER_SETTINGS_EXTENSIONS`): the manifest folds it in, so
 * the namespace stays `.strict()`, `PATCH /api/user-settings` accepts the
 * fields (`null` deletes one) and `GET /api/onboarding` reports them under
 * `settings`.
 *
 * @param shape - the added fields; each optional, never `.default()`.
 * @returns the extension.
 * @throws Error when a field collides with a platform field.
 *
 * @example
 * ```ts
 * export const APP_USER_SETTINGS_EXTENSIONS = [
 *   extendOnboardingSettings({ goal: z.enum(['strength', 'endurance']).optional() }),
 * ];
 * ```
 *
 * @extensionPoint schema
 * @stability experimental
 */
export function extendOnboardingSettings(shape: z.ZodRawShape): UserSettingsNamespaceExtension {
  for (const key of Object.keys(shape)) {
    if ((PLATFORM_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`extendOnboardingSettings: "${key}" is a platform field of the onboarding namespace`);
    }
  }
  return { key: ONBOARDING_SETTINGS_KEY, schema: z.object(shape) };
}

/**
 * The stored `onboarding` namespace as the response reports it, from the raw
 * `user_settings.value`: parsed with the REGISTERED declaration (so an app's
 * extended fields come through), each platform field `null` when unset, and
 * `skipped` reduced to registered, skippable ids. An absent or unparseable
 * namespace reads as all `null`, never as an error.
 *
 * @param value - the raw `user_settings.value`, or `null`.
 * @returns the state.
 *
 * @stability experimental
 */
export function readOnboardingState(value: unknown): OnboardingState {
  const raw =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)[ONBOARDING_SETTINGS_KEY]
      : undefined;
  const schema = userSettingsNamespaceRegistry.get(ONBOARDING_SETTINGS_KEY)?.schema ?? onboardingSettingsSchema;
  const parsed = schema.safeParse(raw ?? {});
  const stored = (parsed.success ? parsed.data : {}) as Record<string, unknown>;
  const skipped = Array.isArray(stored['skipped']) ? (stored['skipped'] as string[]).filter(isSkippableStepId) : [];

  return {
    ...stored,
    welcomeSeenAt: (stored['welcomeSeenAt'] as string | undefined) ?? null,
    checklistDismissedAt: (stored['checklistDismissedAt'] as string | undefined) ?? null,
    adminDismissedAt: (stored['adminDismissedAt'] as string | undefined) ?? null,
    skipped,
  };
}
