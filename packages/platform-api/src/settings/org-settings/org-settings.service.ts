// =============================================================================
// OrgSettingsService: one organization's settings overrides (issue #733)
// =============================================================================
//
// One `org_settings` row per organization, holding ONLY the org-overridable
// fields of each namespace that declares an `org` block: `{ "<namespace>":
// { "<field>": value } }`. Everything else stays deployment-wide in
// `system_settings`. The table is under FORCEd row-level security on
// `org_id`, so every query runs inside `SETTINGS_DATA.runInOrg`, scoped to the
// one organization it reads or writes: organization A's session cannot read
// organization B's row even through a bug here.
//
// The row has its own `version` and `If-Match` (a missing row is version 0),
// and every write is audited with the organization's id.
//
// PERMISSIONS. The routes require `org_settings:read|write`; inside, each
// namespace's own `org.readPermission` / `org.writePermission` gates its
// fields: a caller without a namespace's read permission does not see it at
// all, and a PATCH naming a namespace without its write permission is a 403.
// =============================================================================

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { OrgSettingsNamespace, OrgSettingsResponse, PatchOrgSettingsBody } from '@marinoscar/platform-contract/settings';
import type { z } from 'zod';

import type { SettingsOrgSettingsRow } from '../data/settings-db';
import { SETTINGS_DATA, type SettingsDataPort } from '../ports';
import { systemSettingsNamespaceRegistry, type SystemSettingsNamespace } from '../registry/system-settings-namespace';
import { DEFAULT_SETTINGS_OPTIONS, SETTINGS_OPTIONS, type ResolvedSettingsModuleOptions } from '../settings.options';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { describeOrgFields } from './describe-fields';
import { applyOrgLayer, asPlainObject, readOrgFields } from './org-layer';

/**
 * Who is asking: the permissions the org-scoped reads and writes are gated
 * by (the caller's effective permissions in the active organization).
 *
 * @stability experimental
 */
export interface OrgSettingsAccess {
  /** The acting user, for the audit row; absent for system work. */
  userId?: string;
  /** The caller's effective permissions; absent means "every namespace" (system work). */
  permissions?: readonly string[];
}

/**
 * The audit action of an org-settings write.
 *
 * @stability experimental
 */
export const ORG_SETTINGS_PATCH_AUDIT_ACTION = 'org_settings:patch';

/**
 * One organization's settings overrides: read, patch with `If-Match`, and
 * the stored fields of one namespace. Exported by `SettingsModule`; the
 * `/api/org-settings` controller and `SettingsResolver` use it.
 *
 * @stability experimental
 */
@Injectable()
export class OrgSettingsService {
  private readonly logger = new Logger(OrgSettingsService.name);
  private readonly options: ResolvedSettingsModuleOptions;

  constructor(
    @Inject(SETTINGS_DATA) private readonly data: SettingsDataPort,
    private readonly systemSettings: SystemSettingsService,
    @Optional() @Inject(SETTINGS_OPTIONS) options?: ResolvedSettingsModuleOptions,
  ) {
    this.options = options ?? DEFAULT_SETTINGS_OPTIONS;
  }

  /**
   * Whether the org layer is on (`SettingsModuleOptions.orgLayer` is not `false`).
   *
   * @returns `true` unless the app switched it off.
   */
  isEnabled(): boolean {
    return this.options.orgLayer !== false;
  }

  /**
   * The registered namespaces that declare an `org` block, in registration order.
   *
   * @returns the org-overridable namespaces.
   */
  overridableNamespaces(): SystemSettingsNamespace[] {
    return systemSettingsNamespaceRegistry.list().filter((ns) => ns.org !== undefined);
  }

  /**
   * The organization's stored overrides, the effective value of each
   * org-overridable namespace, the version and the namespace descriptors,
   * filtered to what `access` may read.
   *
   * @param orgId - the organization.
   * @param access - the caller; omit for system work (no filtering).
   * @returns the `GET /api/org-settings` payload.
   * @throws NotFoundException when the org layer is off.
   */
  async get(orgId: string, access: OrgSettingsAccess = {}): Promise<OrgSettingsResponse> {
    this.assertEnabled();
    const row = await this.loadRow(orgId, access.userId);
    return this.toResponse(orgId, row, access);
  }

  /**
   * The stored org fields of one namespace (salvaged), or `undefined` when the
   * organization overrides nothing in it, the namespace has no org block, or
   * the org layer is off.
   *
   * @param orgId - the organization.
   * @param key - the namespace key.
   * @returns the org's stored fields of that namespace.
   */
  async getNamespace(orgId: string, key: string): Promise<Record<string, unknown> | undefined> {
    if (!this.isEnabled()) return undefined;
    const ns = systemSettingsNamespaceRegistry.get(key);
    if (!ns?.org) return undefined;
    const row = await this.loadRow(orgId);
    return readOrgFields(ns, asPlainObject(row?.value)?.[key]);
  }

  /**
   * Applies a patch to the organization's overrides. A namespace branch of
   * `null` clears the organization's override of that namespace; inside a
   * branch, a field of `null` is removed (the system value applies again) and
   * any other value replaces the stored one. Each resulting branch is
   * validated against the namespace's `org.schema`.
   *
   * @param orgId - the organization.
   * @param patch - the parsed body.
   * @param access - the caller (permissions gate each namespace).
   * @param expectedVersion - the `If-Match` version, when sent (`0` matches a missing row).
   * @returns the new `GET` payload.
   * @throws BadRequestException for an unknown or non-overridable namespace or an invalid value.
   * @throws ForbiddenException for a namespace the caller may not write.
   * @throws ConflictException on a stale `If-Match`.
   */
  async patch(
    orgId: string,
    patch: PatchOrgSettingsBody,
    access: OrgSettingsAccess = {},
    expectedVersion?: number,
  ): Promise<OrgSettingsResponse> {
    this.assertEnabled();
    const branches = Object.entries(patch);
    if (branches.length === 0) throw new BadRequestException('The patch names no namespace.');

    // Validate the shape of the request before touching the database.
    const targets: Array<{ ns: SystemSettingsNamespace; branch: Record<string, unknown> | null }> = [];
    for (const [key, branch] of branches) {
      const ns = systemSettingsNamespaceRegistry.get(key);
      if (!ns) throw new BadRequestException(`Unknown settings namespace "${key}".`);
      if (!ns.org) {
        throw new BadRequestException(`Settings namespace "${key}" cannot be overridden per organization.`);
      }
      if (!this.may(access, ns.org.writePermission)) {
        throw new ForbiddenException(`Changing the "${key}" settings of an organization requires ${ns.org.writePermission}.`);
      }
      targets.push({ ns, branch });
    }

    const row = await this.data.runInOrg({ orgId, ...(access.userId ? { userId: access.userId } : {}) }, async (tx) => {
      const current = await tx.orgSettings.findUnique({ where: { orgId } });
      const currentVersion = current?.version ?? 0;
      if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
        throw new ConflictException(
          `Organization settings version mismatch. Expected ${expectedVersion}, found ${currentVersion}`,
        );
      }

      // Carry forward what this patch does not name, including namespaces the
      // code no longer knows (the system document's preservation rule).
      const value: Record<string, unknown> = { ...(asPlainObject(current?.value) ?? {}) };
      for (const { ns, branch } of targets) {
        const next = this.mergeBranch(ns, asPlainObject(value[ns.key]), branch);
        if (next === undefined) delete value[ns.key];
        else value[ns.key] = next;
      }

      const written = current
        ? await tx.orgSettings.update({
            where: { orgId },
            data: { value, version: { increment: 1 }, updatedByUserId: access.userId ?? null },
          })
        : await tx.orgSettings.create({
            data: { orgId, value, updatedByUserId: access.userId ?? null },
          });

      await tx.auditEvent.create({
        data: {
          actorUserId: access.userId ?? null,
          action: ORG_SETTINGS_PATCH_AUDIT_ACTION,
          targetType: 'org_settings',
          targetId: written.id,
          orgId,
          meta: { changes: patch, resultingValue: value } as never,
        },
      });
      return written;
    });

    this.logger.log(`Organization settings patched for org ${orgId} by ${access.userId ?? 'system'}`);
    return this.toResponse(orgId, row, access);
  }

  // ---------------------------------------------------------------------------

  private assertEnabled(): void {
    if (!this.isEnabled()) throw new NotFoundException('Organization settings are not enabled in this deployment.');
  }

  private may(access: OrgSettingsAccess, permission: string): boolean {
    return access.permissions === undefined || access.permissions.includes(permission);
  }

  private async loadRow(orgId: string, userId?: string): Promise<SettingsOrgSettingsRow | null> {
    return this.data.runInOrg({ orgId, ...(userId ? { userId } : {}) }, (tx) =>
      tx.orgSettings.findUnique({ where: { orgId } }),
    );
  }

  /** One namespace branch merged into the stored fields; `undefined` when nothing remains. */
  private mergeBranch(
    ns: SystemSettingsNamespace,
    stored: Record<string, unknown> | undefined,
    branch: Record<string, unknown> | null,
  ): Record<string, unknown> | undefined {
    if (branch === null) return undefined;
    const org = ns.org!;
    const shape = org.schema.shape as Record<string, z.ZodType>;
    const next: Record<string, unknown> = { ...(readOrgFields(ns, stored) ?? {}) };
    for (const [field, value] of Object.entries(branch)) {
      if (!Object.hasOwn(shape, field)) {
        throw new BadRequestException(`"${ns.key}.${field}" cannot be overridden per organization.`);
      }
      if (value === null) delete next[field];
      else next[field] = value;
    }
    const parsed = org.schema.safeParse(next);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid "${ns.key}" organization settings: ${parsed.error.issues
          .map((issue) => `${[ns.key, ...issue.path.map(String)].join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const clean = Object.fromEntries(Object.entries(parsed.data as Record<string, unknown>).filter(([, v]) => v !== undefined));
    return Object.keys(clean).length > 0 ? clean : undefined;
  }

  private async toResponse(
    orgId: string,
    row: SettingsOrgSettingsRow | null,
    access: OrgSettingsAccess,
  ): Promise<OrgSettingsResponse> {
    const stored = asPlainObject(row?.value) ?? {};
    const system = (await this.systemSettings.readKnownValue()) as unknown as Record<string, unknown>;
    const value: Record<string, Record<string, unknown>> = {};
    const effective: Record<string, unknown> = {};
    const namespaces: OrgSettingsNamespace[] = [];
    for (const ns of this.overridableNamespaces()) {
      const org = ns.org!;
      if (!this.may(access, org.readPermission)) continue;
      const fields = readOrgFields(ns, stored[ns.key]);
      if (fields) value[ns.key] = fields;
      effective[ns.key] = applyOrgLayer(ns, system[ns.key], fields).value;
      namespaces.push({
        key: ns.key,
        description: ns.description,
        merge: org.merge === 'override' ? 'override' : 'tighten',
        writable: this.may(access, org.writePermission),
        fields: describeOrgFields(org.schema),
      });
    }
    return {
      orgId,
      value,
      effective,
      version: row?.version ?? 0,
      namespaces,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }
}
