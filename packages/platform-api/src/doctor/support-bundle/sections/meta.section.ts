// The `meta` support-bundle section (issue #772): which platform packages are
// installed, at which versions, and which sections the bundle holds. Built in;
// registered by `DoctorModule.forRoot()`.
//
// NO ACTOR: the caller's id and email are audited, never written into the
// bundle.

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import type { SupportBundleSection } from '../support-bundle-section.interface';
import { SupportBundleRegistry } from '../support-bundle.registry';

/**
 * The platform packages whose versions the `meta` section reports, when installed.
 *
 * @stability experimental
 */
export const PLATFORM_PACKAGE_NAMES: readonly string[] = Object.freeze([
  '@marinoscar/platform-contract',
  '@marinoscar/platform-api',
  '@marinoscar/platform-web',
  '@marinoscar/platform-db',
  '@marinoscar/platform-cli',
  '@marinoscar/platform-infra',
]);

const metaSectionSchema = z
  .object({
    platformPackages: z
      .record(z.string().regex(/^@marinoscar\/platform-[a-z]+$/), z.string().max(64))
      .describe('Installed platform packages and their versions; a package that is not installed is absent.'),
    sections: z.array(z.string()).describe('The section ids this bundle holds, in registration order.'),
  })
  .strict();

/**
 * The `meta` section's data.
 *
 * @stability experimental
 */
export type MetaSupportBundleData = z.infer<typeof metaSectionSchema>;

/** Reads `<name>/package.json`'s version, or `null` when the package is not installed. */
function installedVersion(name: string): string | null {
  try {
    // Every platform package exports `./package.json`.
    const manifest = require(`${name}/package.json`) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * The built-in `meta` section: platform package versions and section ids.
 *
 * @stability experimental
 */
@Injectable()
export class MetaSupportBundleSection implements SupportBundleSection<MetaSupportBundleData>, OnModuleInit {
  readonly id = 'meta';
  readonly label = 'Bundle metadata';
  readonly schema = metaSectionSchema;

  constructor(@Inject(SupportBundleRegistry) private readonly registry: SupportBundleRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async collect(): Promise<MetaSupportBundleData> {
    const platformPackages: Record<string, string> = {};
    for (const name of PLATFORM_PACKAGE_NAMES) {
      const version = installedVersion(name);
      if (version !== null) platformPackages[name] = version;
    }
    return { platformPackages, sections: this.registry.list().map((section) => section.id) };
  }
}
