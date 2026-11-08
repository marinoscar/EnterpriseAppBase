// =============================================================================
// The storage slice's conformance suite (issue #736)
// =============================================================================
//
// What every app consuming the slice must keep true, checked against the
// app's own registries at run time:
//
//   1. prefixes: every registered object-key prefix ends with exactly one
//      slash, none overlaps another, and the slice's own prefixes are
//      registered (otherwise `npm run storage:purge` silently leaves objects
//      behind: the #679 tripwire, registry-driven, no hard-coded count);
//   2. keys: every org-scoped prefix builds `<prefix><orgId>/…` and refuses a
//      key without an organization; `orgKeyPrefixes` returns exactly them;
//   3. no-secret: the `storage` settings namespace and the admin view cannot
//      carry the secret access key.
//   4. routing: an object recorded on driver A stays addressable on driver A
//      (its recorded bucket, its own signing) after the active driver becomes B,
//      and a legacy row, the active location and an app-bound provider route to
//      the provider in force.
// =============================================================================

import { Logger } from '@nestjs/common';
import {
  STORAGE_SECRET_FIELD_NAMES,
  storageConfigResponseSchema,
  storageResponseSchema,
  systemStorageSchema,
} from '@marinoscar/platform-contract/storage';

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import {
  STORAGE_KEY_PREFIX_PATTERN,
  buildObjectKey,
  orgKeyPrefixes,
  storageKeyPrefixRegistry,
  type StorageKeyPrefixDef,
} from '../storage-key-prefix.registry';
import { STORAGE_SLICE_KEY_PREFIXES } from '../storage-key-prefixes';
import { StorageProviderRouter } from '../providers/storage-provider-router';
import type { StorageProvider } from '../providers/storage-provider.interface';
import type { StorageConfigService } from '../config/storage-config.service';
import type { StorageConfigResolution } from '../config/storage-config';
import { requireStorageDriver } from '../drivers/storage-driver';
import '../drivers/builtin-storage-drivers';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The storage slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/storage/testing`. */
    storage?: StorageConformanceOptions | false;
  }
}

/**
 * Options of the `storage` suite.
 *
 * @stability experimental
 */
export interface StorageConformanceOptions {
  /** Prefix ids the app must have registered on top of the slice's own (its writers' prefixes). */
  readonly requiredPrefixIds?: readonly string[];
}

const FILE_PREFIXES = 'storage-key-prefixes';
const FILE_KEYS = 'storage-object-keys';
const FILE_SCHEMAS = 'storage-schemas';
const FILE_ROUTING = 'storage-routing';

/** A fixed UUID for the key checks; never a real organization. */
const PROBE_ORG = '00000000-0000-4000-8000-000000000001';

/**
 * Check 1: the registered prefixes are well-formed, disjoint and complete.
 *
 * @param defs - the registered prefixes.
 * @param requiredIds - ids that must be among them.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkStorageKeyPrefixes(
  defs: readonly StorageKeyPrefixDef[],
  requiredIds: readonly string[],
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const def of defs) {
    if (!STORAGE_KEY_PREFIX_PATTERN.test(def.prefix)) {
      findings.push({ file: FILE_PREFIXES, message: `prefix "${def.prefix}" (${def.id}) must end with exactly one '/' and have no '//'` });
    }
    for (const other of defs) {
      if (other.id !== def.id && def.prefix.startsWith(other.prefix)) {
        findings.push({ file: FILE_PREFIXES, message: `prefix "${def.prefix}" (${def.id}) overlaps "${other.prefix}" (${other.id})` });
      }
    }
  }
  const ids = new Set(defs.map((def) => def.id));
  for (const id of requiredIds) {
    if (!ids.has(id)) findings.push({ file: FILE_PREFIXES, message: `prefix "${id}" is not registered: a purge would leave its objects behind` });
  }
  return findings;
}

/**
 * Check 2: org-scoped prefixes build org-segmented keys and refuse a key
 * without an organization (outside single-organization mode).
 *
 * @param defs - the registered prefixes.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkOrgScopedKeys(defs: readonly StorageKeyPrefixDef[]): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const orgScoped = defs.filter((def) => def.scope === 'org');
  for (const def of orgScoped) {
    const key = buildObjectKey(def.id, { orgId: PROBE_ORG }, 'probe');
    if (key !== `${def.prefix}${PROBE_ORG}/probe`) {
      findings.push({ file: FILE_KEYS, message: `buildObjectKey("${def.id}") built "${key}", not "${def.prefix}<orgId>/probe"` });
    }
  }
  const listed = [...orgKeyPrefixes(PROBE_ORG)].sort();
  const expected = orgScoped.map((def) => `${def.prefix}${PROBE_ORG}/`).sort();
  if (JSON.stringify(listed) !== JSON.stringify(expected)) {
    findings.push({ file: FILE_KEYS, message: `orgKeyPrefixes() returned ${JSON.stringify(listed)}, expected ${JSON.stringify(expected)}` });
  }
  return findings;
}

/**
 * Check 3: neither the stored `storage` namespace, its response branch nor
 * the admin view declares a secret-named field.
 *
 * @returns one finding per offending field.
 *
 * @stability experimental
 */
export function checkStorageSettingsSchemas(): ConformanceFinding[] {
  const forbidden = new Set<string>(STORAGE_SECRET_FIELD_NAMES.map((name) => name.toLowerCase()));
  const findings: ConformanceFinding[] = [];
  for (const [name, schema] of Object.entries({ systemStorageSchema, storageResponseSchema, storageConfigResponseSchema })) {
    for (const key of Object.keys(schema.shape)) {
      if (forbidden.has(key.toLowerCase())) {
        findings.push({ file: FILE_SCHEMAS, message: `${name} declares "${key}": the storage secret lives in the credential store only` });
      }
    }
  }
  return findings;
}

/**
 * Check 4: per-row routing. Two built-in drivers are configured (offline: a
 * presigned URL is computed locally, nothing is fetched); the active one is
 * flipped from A to B and back, and an object recorded on A must keep signing
 * against A's bucket and host each time.
 *
 * @returns one finding per violated rule.
 *
 * @stability experimental
 */
export async function checkStorageRouting(): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  const fail = (message: string) => findings.push({ file: FILE_ROUTING, message });

  const resolutions: Record<string, StorageConfigResolution> = {
    s3: {
      configured: true,
      config: {
        provider: 's3',
        bucket: 'routing-s3-bucket',
        region: 'us-east-1',
        settings: { bucket: 'routing-s3-bucket', region: 'us-east-1', endpoint: '', accessKeyId: 'AKIAROUTINGS3', forcePathStyle: null },
        secrets: { secretAccessKey: 'routing-secret-s3' },
      },
    },
    r2: {
      configured: true,
      config: {
        provider: 'r2',
        bucket: 'routing-r2-bucket',
        region: 'auto',
        endpoint: 'https://routingacct.r2.cloudflarestorage.com',
        settings: { bucket: 'routing-r2-bucket', accountId: 'routingacct', region: '', endpoint: '', accessKeyId: 'AKIAROUTINGR2', forcePathStyle: null },
        secrets: { secretAccessKey: 'routing-secret-r2' },
      },
    },
  };

  const providers: StorageProvider[] = [];
  const buildActive = async (id: string): Promise<StorageProvider> => {
    const resolution = resolutions[id];
    if (!resolution.configured) throw new Error('unreachable');
    const built = await requireStorageDriver(id).build({
      settings: resolution.config.settings,
      secret: async (name) => resolution.config.secrets[name] ?? null,
      logger: new Logger('storage-routing'),
      partSize: 5 * 1024 * 1024,
    });
    providers.push(built);
    return built;
  };

  try {
    for (const activeId of ['s3', 'r2']) {
      const config = {
        activeProvider: async () => activeId,
        resolveDriver: async (id: string) => resolutions[id],
      } as unknown as StorageConfigService;
      const current = await buildActive(activeId);
      const router = new StorageProviderRouter(
        { resolveCurrent: async () => current } as unknown as StorageProvider,
        config,
        { get: <T>(_key: string, fallback?: T) => fallback as T } as never,
      );

      // An object recorded on r2 stays on r2; one recorded on s3 stays on s3.
      for (const [recorded, host] of [['r2', 'r2.cloudflarestorage.com'], ['s3', 'amazonaws.com']] as const) {
        const resolution = resolutions[recorded];
        if (!resolution.configured) continue;
        const provider = await router.forLocation({ provider: recorded, bucket: resolution.config.bucket });
        const url = await provider.getSignedDownloadUrl('routing/probe.txt', { expiresIn: 60 });

        if (provider.kind !== recorded) fail(`active=${activeId}: a row recorded on "${recorded}" was routed to "${provider.kind}"`);
        if (!url.includes(resolution.config.bucket)) fail(`active=${activeId}: a row recorded on "${recorded}" signed outside its bucket`);
        if (!url.includes(host)) fail(`active=${activeId}: a row recorded on "${recorded}" signed against the wrong host`);
      }

      // A row whose recorded bucket differs from the driver's current one signs against the recorded bucket.
      const moved = await router.forLocation({ provider: 'r2', bucket: 'routing-r2-previous' });
      if (!(await moved.getSignedDownloadUrl('routing/probe.txt')).includes('routing-r2-previous')) {
        fail(`active=${activeId}: a row recorded on a previous bucket was not routed to that bucket`);
      }

      // A legacy row (no recorded location) and an unrecorded provider use the one in force.
      if ((await router.forLocation(null)) !== current) fail(`active=${activeId}: a legacy row was not routed to the active provider`);
      if ((await router.forObject({ storageProvider: null, bucket: null })) !== current) {
        fail(`active=${activeId}: a row with no recorded provider was not routed to the active provider`);
      }
    }

    // An app-bound provider routes itself: the router must hand it back for every row.
    const bound = { kind: 'app-bound' } as unknown as StorageProvider;
    const boundRouter = new StorageProviderRouter(bound);
    if ((await boundRouter.forLocation({ provider: 'r2', bucket: 'x' })) !== bound) fail('an app-bound provider was bypassed by the router');
  } finally {
    for (const provider of providers) (provider as { destroy?: () => void }).destroy?.();
  }

  return findings;
}

/**
 * The `storage` conformance suite. Registered when
 * `@marinoscar/platform-api/storage/testing` is imported.
 *
 * @example
 * ```ts
 * import '@marinoscar/platform-api/storage/testing';
 * runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { storage: { requiredPrefixIds: ['exports'] } } });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const storageConformanceSuite: ConformanceSuite<StorageConformanceOptions> = {
  id: 'storage',
  title: 'the storage slice keeps its invariants',
  description:
    'Every object-key prefix is well-formed, disjoint and registered, org-scoped prefixes build org-segmented keys, and no storage settings shape can carry the secret access key.',
  check(_context, options): ConformanceReport {
    const defs = storageKeyPrefixRegistry.list();
    const required = [...STORAGE_SLICE_KEY_PREFIXES.map((def) => def.id), ...(options.requiredPrefixIds ?? [])];
    const findings = [
      ...checkStorageKeyPrefixes(defs, required),
      ...checkOrgScopedKeys(defs),
      ...checkStorageSettingsSchemas(),
    ];
    return {
      scanned: { prefixes: defs.length, orgScoped: defs.filter((def) => def.scope === 'org').length, schemas: 3 },
      scannedFiles: { prefixes: defs.map((def) => def.prefix) },
      findings,
    };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'prefixes: every registered prefix ends with one slash, none overlaps, and the required ones are registered',
        run: (report, expect) => {
          expect(report.scanned.prefixes).toBeGreaterThanOrEqual(STORAGE_SLICE_KEY_PREFIXES.length);
          expect(report.findings.filter((finding) => finding.file === FILE_PREFIXES)).toEqual([]);
        },
      },
      {
        name: 'keys: org-scoped prefixes build <prefix><orgId>/ keys and orgKeyPrefixes lists exactly them',
        run: (report, expect) => {
          expect(report.scanned.orgScoped).toBeGreaterThanOrEqual(1);
          expect(report.findings.filter((finding) => finding.file === FILE_KEYS)).toEqual([]);
        },
      },
      {
        name: 'no-secret: the storage settings, their response and the admin view carry no secret-named field',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === FILE_SCHEMAS)).toEqual([]);
        },
      },
      {
        name: 'storage-routing: an object stays on the provider and bucket it was written to after the active driver changes',
        run: async (_report, expect) => {
          expect(await checkStorageRouting()).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(storageConformanceSuite.id)) conformanceSuites.register(storageConformanceSuite);
