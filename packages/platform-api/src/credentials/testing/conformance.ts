// =============================================================================
// The credentials slice's conformance suite (issue #735, PP-8.8)
// =============================================================================
//
// The slice's invariants, checked against the APP that consumes the package
// (spec: "Conformance suites travel with packages"). Importing
// `@marinoscar/platform-api/credentials/testing` registers the `credentials`
// suite with `runPlatformConformance()`.
//
//   1. owners: every registered credential purpose names a known owner (a
//      platform slice, or one of the app's own owners).
//   2. addresses: every user credential purpose's `system` and `org` address
//      names a registered purpose of that tier, so the resolver's fallback can
//      be written to.
//   3. no-secret-egress: no credential `*Info` response schema declares a
//      secret-bearing, row-id or owner-id property.
//
// Run it after the app's purpose manifest has been imported (the reference
// app imports `platform/credentials/credentials.config.ts`).
// =============================================================================

import {
  SECRET_BEARING_KEYS,
  credentialInfoSchema,
  orgCredentialInfoSchema,
  userCredentialInfoSchema,
} from '@marinoscar/platform-contract/credentials';

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import {
  credentialPurposeRegistry,
  danglingCredentialAddresses,
  userCredentialPurposeRegistry,
  type CredentialPurposeDef,
  type UserCredentialPurposeDef,
} from '../registry';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The credentials slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/credentials/testing`. */
    credentials?: CredentialsConformanceOptions | false;
  }
}

/**
 * The platform slices that may own a credential purpose.
 *
 * @stability experimental
 */
export const PLATFORM_CREDENTIAL_OWNERS: readonly string[] = Object.freeze([
  'core',
  'identity',
  'settings',
  'jobs',
  'nodes',
  'storage',
  'email',
  'notifications',
  'ai',
  'db-backup',
  'telemetry',
  'credentials',
  'sharing',
  'doctor',
]);

/**
 * A response schema the suite scans: anything with a zod object `shape`.
 *
 * @stability experimental
 */
export interface CredentialsConformanceSchema {
  /** The schema's properties. */
  readonly shape: Readonly<Record<string, unknown>>;
}

/**
 * Options of the `credentials` suite.
 *
 * @stability experimental
 */
export interface CredentialsConformanceOptions {
  /**
   * Owners the app may name besides {@link PLATFORM_CREDENTIAL_OWNERS}.
   *
   * @defaultValue `['app']`
   */
  readonly appOwners?: readonly string[];
  /**
   * Extra presentation schemas to scan beside the contract's three (an app's
   * own credential response DTOs), by name.
   */
  readonly infoSchemas?: Readonly<Record<string, CredentialsConformanceSchema>>;
  /** The purposes to check (default: the registries). For the suite's own tests. */
  readonly purposes?: readonly CredentialPurposeDef[];
  /** The user purposes to check (default: the registry). For the suite's own tests. */
  readonly userPurposes?: readonly UserCredentialPurposeDef[];
}

const FILE_OWNERS = 'credential-purposes';
const FILE_ADDRESSES = 'user-credential-purposes';
const FILE_SCHEMAS = 'schemas';

/** The contract's credential presentation schemas. */
const CONTRACT_INFO_SCHEMAS: Readonly<Record<string, CredentialsConformanceSchema>> = {
  credentialInfoSchema,
  userCredentialInfoSchema,
  orgCredentialInfoSchema,
};

/**
 * Check 1: every purpose names a known owner.
 *
 * @param purposes - the system and org purposes.
 * @param appOwners - the app's own owners.
 * @returns one finding per purpose with an unknown owner.
 *
 * @stability experimental
 */
export function checkCredentialOwners(purposes: readonly CredentialPurposeDef[], appOwners: readonly string[]): ConformanceFinding[] {
  const known = new Set([...PLATFORM_CREDENTIAL_OWNERS, ...appOwners]);
  return purposes
    .filter((def) => !known.has(def.owner))
    .map((def) => ({
      file: FILE_OWNERS,
      message: `purpose "${def.purpose}" names owner "${def.owner}", which is neither a platform slice nor one of the app's owners (${[...appOwners].join(', ') || 'none'})`,
    }));
}

/**
 * Check 2: every user purpose's addresses name a registered purpose of the
 * right tier.
 *
 * @param userPurposes - the user credential purposes.
 * @param purposes - the system and org purposes.
 * @returns one finding per dangling address.
 *
 * @stability experimental
 */
export function checkCredentialAddresses(
  userPurposes: readonly UserCredentialPurposeDef[],
  purposes: readonly CredentialPurposeDef[],
): ConformanceFinding[] {
  const byId = new Map(purposes.map((def) => [def.purpose, def]));
  return danglingCredentialAddresses(userPurposes, { get: (id: string) => byId.get(id) }).map((message) => ({ file: FILE_ADDRESSES, message }));
}

/**
 * Check 3: no presentation schema declares a secret-bearing, id or owner property.
 *
 * @param schemas - the schemas, by name.
 * @returns one finding per offending property.
 *
 * @stability experimental
 */
export function checkCredentialInfoSchemas(schemas: Readonly<Record<string, CredentialsConformanceSchema>>): ConformanceFinding[] {
  const forbidden = new Set<string>([...SECRET_BEARING_KEYS, 'id', 'userId', 'orgId']);
  const findings: ConformanceFinding[] = [];
  for (const [name, schema] of Object.entries(schemas)) {
    for (const key of Object.keys(schema.shape)) {
      if (forbidden.has(key)) findings.push({ file: FILE_SCHEMAS, message: `${name} declares "${key}": a credential response must never carry a secret, the ciphertext or an id` });
    }
  }
  return findings;
}

/**
 * The `credentials` conformance suite. Registered when
 * `@marinoscar/platform-api/credentials/testing` is imported.
 *
 * @example
 * ```ts
 * import '@marinoscar/platform-api/credentials/testing';
 * runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { credentials: { appOwners: ['app'] } } });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const credentialsConformanceSuite: ConformanceSuite<CredentialsConformanceOptions> = {
  id: 'credentials',
  title: 'the credentials slice keeps its invariants',
  description:
    'Every credential purpose names a known owner, every user purpose falls back to a registered purpose of the right tier, and no credential response schema can carry a secret.',
  check(_context, options): ConformanceReport {
    const purposes = options.purposes ?? credentialPurposeRegistry.list();
    const userPurposes = options.userPurposes ?? userCredentialPurposeRegistry.list();
    const schemas = { ...CONTRACT_INFO_SCHEMAS, ...(options.infoSchemas ?? {}) };
    const findings = [
      ...checkCredentialOwners(purposes, options.appOwners ?? ['app']),
      ...checkCredentialAddresses(userPurposes, purposes),
      ...checkCredentialInfoSchemas(schemas),
    ];
    return {
      scanned: { purposes: purposes.length, userPurposes: userPurposes.length, schemas: Object.keys(schemas).length },
      scannedFiles: { purposes: purposes.map((def) => def.purpose), schemas: Object.keys(schemas) },
      findings,
    };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'owners: every credential purpose names a platform slice or an app owner',
        run: (report, expect) => {
          expect(report.scanned.purposes).toBeGreaterThanOrEqual(1);
          expect(report.findings.filter((finding) => finding.file === FILE_OWNERS)).toEqual([]);
        },
      },
      {
        name: "addresses: every user purpose's system and org address names a registered purpose of that tier",
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === FILE_ADDRESSES)).toEqual([]);
        },
      },
      {
        name: 'no-secret-egress: no credential *Info schema has a secret-bearing or id property',
        run: (report, expect) => {
          expect(report.scanned.schemas).toBeGreaterThanOrEqual(3);
          expect(report.findings.filter((finding) => finding.file === FILE_SCHEMAS)).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(credentialsConformanceSuite.id)) conformanceSuites.register(credentialsConformanceSuite);
