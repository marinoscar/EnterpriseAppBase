// =============================================================================
// Support-bundle section registry (issue #772, PP-13.1)
// =============================================================================
//
// The one place that knows which sections `GET /api/admin/doctor/support-bundle`
// collects. The same mechanism as `DoctorCheckRegistry` and for the same
// reasons (read its header): explicit self-registration from `onModuleInit`,
// duplicate ids THROW at boot, and the registry freezes in
// `onApplicationBootstrap`, after every module's `onModuleInit` has run.
//
// Ids are restricted to lowercase identifiers because they become JSON keys of
// the bundle and the keys of the download's audit row.
// =============================================================================

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { Registry } from '../../core/index';
import type { SupportBundleSection } from './support-bundle-section.interface';

/** Lowercase letters, digits, `.`, `_` and `-`, starting with a letter. */
const SECTION_ID_PATTERN = /^[a-z][a-z0-9._-]*$/;

/**
 * The sections the support bundle collects. Provided (globally) by
 * `DoctorModule.forRoot()`; a feature module's section injects it and
 * registers itself from `onModuleInit`.
 *
 * @stability experimental
 */
@Injectable()
export class SupportBundleRegistry implements OnApplicationBootstrap {
  private readonly sections = new Registry<SupportBundleSection>({
    name: 'support-bundle-sections',
    idOf: (section) => section.id,
    idPattern: SECTION_ID_PATTERN,
    validate: (section) => {
      if (typeof section.collect !== 'function') throw new Error(`Support-bundle section "${section.id}" has no collect().`);
      if (!section.schema || typeof (section.schema as { safeParse?: unknown }).safeParse !== 'function') {
        throw new Error(`Support-bundle section "${section.id}" has no zod schema.`);
      }
      if (section.timeoutMs !== undefined && (!Number.isFinite(section.timeoutMs) || section.timeoutMs <= 0)) {
        throw new Error(`Support-bundle section "${section.id}" has an invalid timeoutMs.`);
      }
    },
    describeDuplicate: (existing, incoming) =>
      `Duplicate support-bundle section id "${incoming.id}": ${existing.constructor.name} and ` +
      `${incoming.constructor.name} both register it. Section ids must be unique.`,
  });

  /**
   * Adds `section`. Call it from the section's own `onModuleInit`.
   *
   * @param section - the section; its `id` must be unique across the application.
   * @throws RegistryError `DUPLICATE_ID` when another section already uses its
   *   id, `INVALID_ID` for an id that is not a lowercase identifier,
   *   `INVALID_ENTRY` without `collect()` or a zod `schema`, `FROZEN` after the
   *   application has bootstrapped.
   *
   * @example
   * ```ts
   * onModuleInit(): void {
   *   this.registry.register(this);
   * }
   * ```
   *
   * @extensionPoint registry
   */
  register(section: SupportBundleSection): void {
    this.sections.register(section);
  }

  /** The section registered under `id`, or `undefined`. */
  get(id: string): SupportBundleSection | undefined {
    return this.sections.get(id);
  }

  /** Every registered section, in registration order. */
  list(): SupportBundleSection[] {
    return this.sections.list();
  }

  /** Refuses further registrations once every module's `onModuleInit` has run. */
  onApplicationBootstrap(): void {
    this.sections.freeze();
  }
}
