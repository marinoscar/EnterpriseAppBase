// =============================================================================
// SYSTEM_SETTINGS_STORE adapter: packaged slices read and patch the app's
// system settings, one namespace at a time (issue #696, PP-2.7)
// =============================================================================
//
// A thin wrapper, on purpose. `read` goes through `getSettings()` (the one
// `system_settings` row, its JSON `value` validated namespace by namespace,
// and its integer `version`); `patch` is first parsed with the same
// `patchSystemSettingsSchema` the PATCH route's pipe applies (a bad patch is
// the same 400), then goes through `patchSettings(...)`, so the merge
// validation, the If-Match check (a stale version is the same 409
// `ConflictException`) and the settings audit trail all stay exactly where
// they are. Nothing here writes on its own.
// =============================================================================

import { BadRequestException, Injectable } from '@nestjs/common';
import type { SystemSettingsSnapshot, SystemSettingsStore } from '@marinoscar/platform-api/core';

import { patchSystemSettingsSchema } from '../settings/registry/composed';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

/** The projection `getSettings()`/`patchSettings()` return, seen namespace by namespace. */
type SettingsDocument = Record<string, unknown> & { version: number };

/** Response fields of the projection that are not settings namespaces. */
const NOT_NAMESPACES = new Set(['version', 'updatedAt', 'updatedBy', 'security']);

@Injectable()
export class SystemSettingsStoreAdapter implements SystemSettingsStore {
  constructor(private readonly settings: SystemSettingsService) {}

  async read(namespace: string): Promise<SystemSettingsSnapshot> {
    const document = (await this.settings.getSettings()) as unknown as SettingsDocument;

    return this.pick(document, namespace);
  }

  async patch(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: { actorUserId: string; ifMatchVersion?: number },
  ): Promise<SystemSettingsSnapshot> {
    this.assertNamespace(namespace);
    const parsed = patchSystemSettingsSchema.safeParse({ [namespace]: patch });
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid "${namespace}" settings patch: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      );
    }
    const document = (await this.settings.patchSettings(
      parsed.data as Parameters<SystemSettingsService['patchSettings']>[0],
      ctx.actorUserId,
      ctx.ifMatchVersion,
    )) as unknown as SettingsDocument;

    return this.pick(document, namespace);
  }

  private pick(document: SettingsDocument, namespace: string): SystemSettingsSnapshot {
    this.assertNamespace(namespace, document);

    return { value: document[namespace], version: document.version };
  }

  private assertNamespace(namespace: string, document?: SettingsDocument): void {
    // Before a patch, the namespace must be one the PATCH schema knows: zod
    // strips an unknown key, which would turn a typo into an empty patch that
    // still bumps the version and writes an audit event.
    const known =
      document === undefined ? Object.hasOwn(patchSystemSettingsSchema.shape, namespace) : Object.hasOwn(document, namespace);
    if (NOT_NAMESPACES.has(namespace) || !known) {
      throw new Error(`Unknown settings namespace "${namespace}".`);
    }
  }
}
