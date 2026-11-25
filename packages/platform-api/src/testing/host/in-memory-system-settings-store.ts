import { ConflictException } from '@nestjs/common';

import type { SystemSettingsSnapshot, SystemSettingsStore } from '../../core/index';

/**
 * A {@link SystemSettingsStore} over an in-memory document, for package tests.
 *
 * Mirrors the app's semantics: one version for the whole document (one
 * settings row), bumped on every patch; a patch with a stale
 * `ifMatchVersion` throws `ConflictException` (the app's 409) and changes
 * nothing; a namespace patch is merged shallowly into the namespace.
 *
 * @stability experimental
 */
export class InMemorySystemSettingsStore implements SystemSettingsStore {
  private document: Record<string, unknown>;
  private currentVersion: number;

  /**
   * @param initial - namespace to value; the namespaces the store knows.
   * @param version - the starting row version. Default 1.
   */
  constructor(initial: Record<string, unknown> = {}, version = 1) {
    this.document = structuredClone(initial);
    this.currentVersion = version;
  }

  /** The current row version. */
  get version(): number {
    return this.currentVersion;
  }

  /** The namespace's value and the row version. Throws on an unknown namespace. */
  async read(namespace: string): Promise<SystemSettingsSnapshot> {
    this.assertKnown(namespace);
    return { value: structuredClone(this.document[namespace]), version: this.currentVersion };
  }

  /** Merges `patch` into the namespace and bumps the version; 409 on a stale `ifMatchVersion`. */
  async patch(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: { actorUserId: string; ifMatchVersion?: number },
  ): Promise<SystemSettingsSnapshot> {
    this.assertKnown(namespace);
    if (ctx.ifMatchVersion !== undefined && ctx.ifMatchVersion !== this.currentVersion) {
      throw new ConflictException(
        `Settings version mismatch. Expected ${ctx.ifMatchVersion}, found ${this.currentVersion}`,
      );
    }
    const current = this.document[namespace];
    const base = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : {};
    this.document = { ...this.document, [namespace]: { ...base, ...structuredClone(patch) } };
    this.currentVersion += 1;
    return this.read(namespace);
  }

  private assertKnown(namespace: string): void {
    if (!Object.prototype.hasOwnProperty.call(this.document, namespace)) {
      throw new Error(`Unknown settings namespace "${namespace}".`);
    }
  }
}
