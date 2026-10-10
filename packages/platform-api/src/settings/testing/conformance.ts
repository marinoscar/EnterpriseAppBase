// =============================================================================
// The settings slice's conformance suite (issue #733, PP-8.1)
// =============================================================================
//
// The settings invariants, checked against the APP that consumes the package
// (spec: "Conformance suites travel with packages"). Importing
// `@marinoscar/platform-api/settings/testing` registers the `settings` suite
// with `runPlatformConformance()`.
//
//   1. no-secrets: no registered system or user namespace (an app's
//      included, and every org block) declares a secret-named field; the
//      registries refuse one at registration, this re-checks what is
//      registered when the suite runs (an entry added around the registry
//      would otherwise go unseen).
//   2. defaults: every system namespace's defaults satisfy its stored schema
//      (what a missing or damaged row degrades to must be valid).
//   3. org-permissions: every org block names a read and a write permission
//      the app's permission registry holds, with ORG scope.
//   4. catalog (optional): the app's committed defaults catalog equals what
//      the registry renders now.
//
// The registry tripwires of the reference app (`settings-parity.spec.ts`,
// `registry.spec.ts`, `no-cycles.spec.ts`) move here with #742.
// =============================================================================

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { checkSystemSettingsCatalog } from '../registry/catalog';
import { findSecretFieldPaths } from '../registry/schema-walk';
import { SETTINGS_SECRET_FIELD_NAMES } from '../registry/secret-fields';
import { systemSettingsNamespaceRegistry } from '../registry/system-settings-namespace';
import { userSettingsNamespaceRegistry } from '../registry/user-settings-namespace';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The settings slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/settings/testing`. */
    settings?: SettingsConformanceOptions | false;
  }
}

/**
 * What the `settings` suite takes: the app's data, never its code.
 *
 * @stability experimental
 */
export interface SettingsConformanceOptions {
  /** The app's permission registry (`id` and `scope` of every permission). */
  readonly permissions: ReadonlyArray<{
    /** The permission id. */
    readonly id: string;
    /** Its scope. */
    readonly scope: 'system' | 'org';
  }>;
  /**
   * The committed defaults catalog and the fix its staleness message names.
   * Omit to skip the check.
   */
  readonly catalog?: {
    /** The committed file's contents, or `undefined` when it is missing. */
    readonly contents: string | undefined;
    /** What to report when it is stale (the app's fix command). */
    readonly staleMessage: string;
  };
  /** The fewest system namespaces the app must have registered (a wiring check). Default 1. */
  readonly minSystemNamespaces?: number;
}

/**
 * The no-secrets check over everything registered now.
 *
 * @returns one finding per secret-named field.
 *
 * @stability experimental
 */
export function checkNoSecretFields(): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const ns of systemSettingsNamespaceRegistry.list()) {
    const denied = [...SETTINGS_SECRET_FIELD_NAMES, ...(ns.forbiddenKeys ?? [])];
    for (const [part, schema] of [
      ['storedSchema', ns.storedSchema],
      ['putSchema', ns.putSchema],
      ['wirePatchSchema', ns.wirePatchSchema],
      ['responseSchema', ns.responseSchema],
      ['org.schema', ns.org?.schema],
    ] as const) {
      for (const path of findSecretFieldPaths(schema, denied)) {
        findings.push({ file: `system:${ns.key}`, message: `${part} declares the secret-named field ${path}; store it with CredentialsService` });
      }
    }
  }
  for (const ns of userSettingsNamespaceRegistry.list()) {
    const denied = [...SETTINGS_SECRET_FIELD_NAMES, ...(ns.forbiddenKeys ?? [])];
    for (const schema of [ns.schema, ns.patchSchema, ns.putSchema, ns.wirePatchSchema, ns.responseSchema]) {
      for (const path of findSecretFieldPaths(schema, denied)) {
        findings.push({ file: `user:${ns.key}`, message: `declares the secret-named field ${path}` });
      }
    }
  }
  return findings;
}

/**
 * The defaults and org-permission checks.
 *
 * @param options - the suite's options.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkNamespaceDeclarations(options: SettingsConformanceOptions): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const scopes = new Map(options.permissions.map((p) => [p.id, p.scope]));
  for (const ns of systemSettingsNamespaceRegistry.list()) {
    if (!ns.storedSchema.safeParse(ns.defaults).success) {
      findings.push({ file: `system:${ns.key}`, message: 'defaults do not satisfy storedSchema' });
    }
    if (!ns.org) continue;
    for (const field of ['readPermission', 'writePermission'] as const) {
      const id = ns.org[field];
      const scope = scopes.get(id);
      if (scope === undefined) findings.push({ file: `system:${ns.key}`, message: `org.${field} ${id} is not a registered permission` });
      else if (scope !== 'org') findings.push({ file: `system:${ns.key}`, message: `org.${field} ${id} is a ${scope} permission; an org layer is gated by an org permission` });
    }
  }
  return findings;
}

/**
 * The `settings` conformance suite. Registered when
 * `@marinoscar/platform-api/settings/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const settingsConformanceSuite: ConformanceSuite<SettingsConformanceOptions> = {
  id: 'settings',
  title: 'the settings slice keeps its invariants',
  description:
    'No registered settings namespace declares a secret-named field, every default is valid, every org layer is gated by registered org permissions, and the defaults catalog is current.',
  check(_context, options): ConformanceReport {
    const findings = [...checkNoSecretFields(), ...checkNamespaceDeclarations(options)];
    const minimum = options.minSystemNamespaces ?? 1;
    const system = systemSettingsNamespaceRegistry.list();
    if (system.length < minimum) {
      findings.push({ file: 'registry', message: `${system.length} system namespace(s) registered, fewer than ${minimum}: did the app import its manifests?` });
    }
    if (options.catalog) {
      const stale = checkSystemSettingsCatalog(options.catalog.contents, options.catalog.staleMessage);
      if (stale) findings.push({ file: 'catalog', message: stale });
    }
    return {
      scanned: {
        systemNamespaces: system.length,
        userNamespaces: userSettingsNamespaceRegistry.list().length,
        orgLayers: system.filter((ns) => ns.org !== undefined).length,
      },
      scannedFiles: { namespaces: system.map((ns) => ns.key) },
      findings,
    };
  },
  cases(options): ConformanceCase[] {
    const cases: ConformanceCase[] = [
      {
        name: 'no-secrets: no registered namespace declares a secret-named field',
        run: (report, expect) => {
          expect(report.findings.filter((f) => /secret-named/.test(f.message))).toEqual([]);
        },
      },
      {
        name: 'defaults: every system namespace default satisfies its stored schema, and the app registered its namespaces',
        run: (report, expect) => {
          expect(report.findings.filter((f) => /defaults do not|fewer than/.test(f.message))).toEqual([]);
        },
      },
      {
        name: 'org-permissions: every org layer is gated by registered org-scope permissions',
        run: (report, expect) => {
          expect(report.findings.filter((f) => /^org\./.test(f.message))).toEqual([]);
        },
      },
    ];
    if (options.catalog) {
      cases.push({
        name: 'catalog: the committed defaults catalog is current',
        run: (report, expect) => {
          expect(report.findings.filter((f) => f.file === 'catalog')).toEqual([]);
        },
      });
    }
    return cases;
  },
};

if (!conformanceSuites.has(settingsConformanceSuite.id)) conformanceSuites.register(settingsConformanceSuite);
