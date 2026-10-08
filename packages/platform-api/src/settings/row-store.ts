// =============================================================================
// SystemSettingsRowStore: a slice's own `system_settings` row (issue #733)
// =============================================================================
//
// Some configuration has its own lifecycle, provenance or secrets and does not
// belong in the namespaces document: the email transport (`key = 'email'`),
// the telemetry store's connection (`telemetry_connection`), and the rows a
// slice adds later. Each lives in a `system_settings` row of its own, so it
// cannot be clobbered by the main row, keeps its fields out of
// `GET /api/system-settings`, and has its own version counter for `If-Match`
// (docs/API.md, "Optimistic Concurrency": a missing row is version 0).
//
// The store validates on the way in and degrades on the way out (a value
// that fails its schema reads as the defaults, field by field for an object
// schema), refuses the main row's key, and audits every write. It holds no
// secret: put the secret half in `CredentialsService` and store only the
// non-secret half here. Which pages share which row's version is the slice's
// decision; the store does not change it.
// =============================================================================

import { BadRequestException, ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

import { PLATFORM_PRISMA } from '../core/index';
import type { SettingsPrisma, SettingsSystemSettingsRow } from './data/settings-db';
import { asPlainObject } from './org-settings/org-layer';
import { SETTINGS_SECRET_FIELD_NAMES } from './registry/secret-fields';
import { findSecretFieldPaths } from './registry/schema-walk';
import { DEFAULT_SETTINGS_OPTIONS, SETTINGS_OPTIONS, type ResolvedSettingsModuleOptions } from './settings.options';

/**
 * One row read through the store.
 *
 * @typeParam T - the row's value type.
 *
 * @stability experimental
 */
export interface SystemSettingsRowSnapshot<T> {
  /** The value (validated, or the defaults). */
  value: T;
  /** The row version; `0` while the row does not exist. */
  version: number;
  /** When the row last changed, or `null` while it does not exist. */
  updatedAt: Date | null;
  /** Who last changed it, or `null`. */
  updatedByUserId: string | null;
}

/**
 * How a write is attributed and guarded.
 *
 * @stability experimental
 */
export interface SystemSettingsRowWriteOptions<T> {
  /** The acting user; `null` for system work. */
  actorId: string | null;
  /** The expected version (`If-Match`); omit to write unconditionally. `0` matches a missing row. */
  ifMatch?: number;
  /** The schema the value must satisfy; it is parsed (and stripped) before the write. */
  schema: z.ZodType<T>;
  /** The audit action; default `system_settings:<key>:write`. */
  auditAction?: string;
}

const ROW_KEY = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Reads and writes a slice's own `system_settings` row by key. Exported by
 * `SettingsModule`.
 *
 * @example
 * ```ts
 * const { value, version } = await rows.read('email', emailSettingsSchema, EMAIL_DEFAULTS);
 * await rows.write('email', next, { actorId: userId, ifMatch: version, schema: emailSettingsSchema });
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
@Injectable()
export class SystemSettingsRowStore {
  private readonly mainRowKey: string;

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: SettingsPrisma,
    @Optional() @Inject(SETTINGS_OPTIONS) options?: ResolvedSettingsModuleOptions,
  ) {
    this.mainRowKey = (options ?? DEFAULT_SETTINGS_OPTIONS).systemRowKey;
  }

  /**
   * Reads the row `key`. Never creates it. A missing row, or a stored value
   * that fails `schema`, reads as `defaults` (an object schema degrades field
   * by field: a field that fails keeps its default, the others survive).
   *
   * @param key - the row's key (not the main row's).
   * @param schema - the value's schema.
   * @param defaults - what a missing or unusable value reads as.
   * @returns the value and the row's version metadata.
   */
  async read<T>(key: string, schema: z.ZodType<T>, defaults: T): Promise<SystemSettingsRowSnapshot<T>> {
    this.assertKey(key);
    const row = await this.prisma.systemSettings.findUnique<SettingsSystemSettingsRow>({ where: { key } });
    return {
      value: row ? this.salvage(row.value, schema, defaults) : structuredClone(defaults),
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      updatedByUserId: row?.updatedByUserId ?? null,
    };
  }

  /**
   * Writes the row `key` (creating it at version 1), after validating `value`
   * against `options.schema`, and audits the write.
   *
   * @param key - the row's key (not the main row's).
   * @param value - the new value.
   * @param options - the actor, the `If-Match` version and the schema.
   * @returns the written value and version metadata.
   * @throws BadRequestException when the value fails the schema or names a secret field.
   * @throws ConflictException on a stale `ifMatch`.
   */
  async write<T>(key: string, value: T, options: SystemSettingsRowWriteOptions<T>): Promise<SystemSettingsRowSnapshot<T>> {
    this.assertKey(key);
    const secrets = findSecretFieldPaths(options.schema, SETTINGS_SECRET_FIELD_NAMES);
    if (secrets.length > 0) {
      throw new BadRequestException(
        `The "${key}" row schema declares secret-named field(s) ${secrets.join(', ')}; store secrets with CredentialsService.`,
      );
    }
    const parsed = options.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid "${key}" settings: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      );
    }
    const existing = await this.prisma.systemSettings.findUnique<{ version: number }>({
      where: { key },
      select: { version: true },
    });
    const currentVersion = existing?.version ?? 0;
    if (options.ifMatch !== undefined && options.ifMatch !== currentVersion) {
      throw new ConflictException(`Settings "${key}" version mismatch. Expected ${options.ifMatch}, found ${currentVersion}`);
    }
    const row = await this.prisma.systemSettings.upsert<SettingsSystemSettingsRow>({
      where: { key },
      update: { value: parsed.data as never, updatedByUserId: options.actorId, version: { increment: 1 } },
      create: { key, value: parsed.data as never, updatedByUserId: options.actorId },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: options.actorId,
        action: options.auditAction ?? `system_settings:${key}:write`,
        targetType: 'system_settings',
        targetId: row.id,
        meta: { key, version: row.version } as never,
      },
    });
    return {
      value: parsed.data,
      version: row.version,
      updatedAt: row.updatedAt,
      updatedByUserId: row.updatedByUserId,
    };
  }

  private assertKey(key: string): void {
    if (!ROW_KEY.test(key)) throw new Error(`SystemSettingsRowStore: ${JSON.stringify(key)} is not a row key.`);
    if (key === this.mainRowKey) {
      throw new Error(
        `SystemSettingsRowStore: "${key}" is the main settings row; register a namespace (registerSystemSettingsNamespaces) instead of writing it as a row.`,
      );
    }
  }

  private salvage<T>(stored: unknown, schema: z.ZodType<T>, defaults: T): T {
    const whole = schema.safeParse(stored);
    if (whole.success) return whole.data;
    if (!(schema instanceof z.ZodObject)) return structuredClone(defaults);
    const source = asPlainObject(stored) ?? {};
    const fallback = (asPlainObject(defaults) ?? {}) as Record<string, unknown>;
    const value: Record<string, unknown> = {};
    for (const [field, fieldSchema] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      const parsed = fieldSchema.safeParse(source[field]);
      value[field] = parsed.success ? parsed.data : structuredClone(fallback[field]);
    }
    const again = schema.safeParse(value);
    return again.success ? (again.data as T) : structuredClone(defaults);
  }
}
