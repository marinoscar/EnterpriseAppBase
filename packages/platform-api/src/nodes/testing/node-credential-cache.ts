// =============================================================================
// Suite `node-credential-cache` (API side, issue #1083)
// =============================================================================
//
// The server half of opt-in provider-credential delivery, checked against the
// slice's own code with in-memory doubles (no database, no booted app):
//
//   - the policy reader fails closed and clamps the TTL (5..240 minutes);
//   - with delivery disabled a type that declares a purpose is server-only at
//     claim time, and the issuer refuses with CREDENTIAL_DELIVERY_DISABLED;
//   - an issuance writes the audit by purpose and version only: a marker
//     credential reaches the HTTP response and nothing else (not the issuance
//     row, not the audit row, not a log line);
//   - a rotation changes the version; revoke-all advances the epoch, which
//     the heartbeat state then reports.
//
// The CLI half (encrypted cache files, pin-at-start, sweeper, single-flight)
// lands with the node cache in `@marinoscar/platform-cli` (a later change).
// =============================================================================

import { randomBytes } from 'node:crypto';

import { Logger } from '@nestjs/common';

import {
  DEFAULT_NODES_POLICY,
  JobHandlerRegistry,
  NodeOffloadService,
  nodeCredentialPurposeRegistry,
  readNodeCredentialDeliveryPolicy,
  registerNodeCredentialPurpose,
} from '../../jobs/index';
import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { NodeCredentialDeliveryService, nodeCredentialVersion } from '../node-credential-delivery.service';
import { mergeNodesSettings } from '../nodes.system-settings';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The node credential delivery suite (#1083): `{}` to run it, or `false` to opt out. Registered by importing `@marinoscar/platform-api/nodes/testing`. */
    nodeCredentialCache?: NodeCredentialCacheConformanceOptions | false;
  }
}

/**
 * What an app passes as `suites.nodeCredentialCache`. Nothing yet: the suite
 * checks the slice's own behaviour.
 *
 * @stability experimental
 */
export interface NodeCredentialCacheConformanceOptions {
  /** Reserved. */
  readonly _reserved?: never;
}

const PURPOSE = 'conformance:node-credential';
const MARKER = 'sk-conformance-node-credential-marker-Vb38Rt';
const NODE_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const TYPE = 'conformance.node_credential';

let currentKey: string | null = MARKER;

function ensurePurpose(): void {
  if (nodeCredentialPurposeRegistry.get(PURPOSE) !== undefined || nodeCredentialPurposeRegistry.frozen) return;
  registerNodeCredentialPurpose({
    id: PURPOSE,
    label: 'Conformance node credential',
    resolve: async () => (currentKey ? { material: { apiKey: currentKey } } : null),
  });
}

// Registered on import (before an app bootstraps and freezes the registries).
ensurePurpose();

/** One wired service over in-memory doubles. */
function harness(delivery: Record<string, unknown> | undefined) {
  ensurePurpose();
  const writes: unknown[] = [];
  const logs: string[] = [];
  let stored: Record<string, unknown> = { ...DEFAULT_NODES_POLICY, credentialDelivery: delivery };
  const tx = {
    nodeCredentialIssuance: { create: async (args: unknown) => writes.push(args) },
    auditEvent: { create: async (args: unknown) => writes.push(args) },
  };
  const registry = new JobHandlerRegistry();
  registry.register({
    type: TYPE,
    process: async () => undefined,
    nodeResultSchema: { safeParse: () => ({ success: true }) } as never,
    persistNodeResult: async () => undefined,
    nodeCredentialPurposes: [PURPOSE],
  });
  const settings = {
    getNodesPolicy: async () => stored,
    patchSettings: async (body: { nodes: never }) => {
      stored = mergeNodesSettings(stored as never, body.nodes) as never;
    },
  };
  const nodes = {
    getNode: async () => ({ id: NODE_ID }),
    assertJobHeldByNode: async () => ({ id: JOB_ID, type: TYPE, orgId: null }),
  };
  const logger = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    debug: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
  };
  const service = new NodeCredentialDeliveryService(
    { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as never,
    nodes as never,
    registry,
    settings as never,
    { get: () => undefined } as never,
  );
  Object.assign(service as unknown as { logger: unknown }, { logger });
  const offload = new NodeOffloadService(registry, settings as never);
  return { service, offload, writes, logs };
}

/** Runs `fn` with a signing key configured (the version HMAC needs one). */
async function withSigningKey<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.SECRETS_ENCRYPTION_KEY) return fn();
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  try {
    return await fn();
  } finally {
    delete process.env.SECRETS_ENCRYPTION_KEY;
  }
}

const ON = { enabled: true, cacheTtlMinutes: 45, purposes: [PURPOSE], epoch: 1 };

/**
 * The `node-credential-cache` suite (API side). Registered when
 * `@marinoscar/platform-api/nodes/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const nodeCredentialCacheConformanceSuite: ConformanceSuite<NodeCredentialCacheConformanceOptions> = {
  id: 'node-credential-cache',
  title: 'provider-credential delivery to nodes is opt-in, audited without material, and invalidatable (#1083)',
  description:
    'With the defaults no provider credential leaves the server and declaring types are server-only; an enabled issuance audits purpose and version only; rotation changes the version; revoke-all advances the epoch; the TTL is clamped to 5..240 minutes.',
  check(): ConformanceReport {
    return { scanned: { purposes: nodeCredentialPurposeRegistry.list().length }, scannedFiles: {}, findings: [] };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'policy: fails closed and clamps the cache TTL to 5..240 minutes',
        run: (_report, expect) => {
          expect(readNodeCredentialDeliveryPolicy(undefined).enabled).toEqual(false);
          expect(readNodeCredentialDeliveryPolicy({ credentialDelivery: { enabled: 'true' } }).enabled).toEqual(false);
          expect(readNodeCredentialDeliveryPolicy({ credentialDelivery: { enabled: true, cacheTtlMinutes: 9999 } }).cacheTtlMinutes).toEqual(240);
          expect(readNodeCredentialDeliveryPolicy({ credentialDelivery: { enabled: true, cacheTtlMinutes: 0 } }).cacheTtlMinutes).toEqual(5);
        },
      },
      {
        name: 'disabled: a declaring type is server-only at claim time and the issuer refuses CREDENTIAL_DELIVERY_DISABLED',
        run: async (_report, expect) => {
          const { service, offload, writes } = harness(undefined);
          expect(await offload.serverOnlyRightNow()).toContain(TYPE);
          let reason: unknown;
          try {
            await service.issue('owner', NODE_ID, PURPOSE, { jobId: JOB_ID });
          } catch (error) {
            reason = (error as { getResponse?: () => { details?: { reason?: unknown } } }).getResponse?.().details?.reason;
          }
          expect(reason).toEqual('CREDENTIAL_DELIVERY_DISABLED');
          expect(writes).toEqual([]);
          expect(await service.deliveryState()).toEqual({ enabled: false, epoch: 1, ttlMinutes: 60, purposes: [], versions: {} });
        },
      },
      {
        name: 'enabled: the marker reaches the response only, never the issuance row, the audit row or a log line',
        run: async (_report, expect) =>
          withSigningKey(async () => {
            const silenced = (['log', 'warn', 'error', 'debug'] as const).map((method) => {
              const original = Logger.prototype[method];
              Logger.prototype[method] = () => undefined;
              return () => {
                Logger.prototype[method] = original;
              };
            });
            try {
              currentKey = MARKER;
              const { service, offload, writes, logs } = harness(ON);
              expect(await offload.offeredTypes()).toContain(TYPE);
              const issued = await service.issue('owner', NODE_ID, PURPOSE, { jobId: JOB_ID });
              expect(issued.material).toEqual({ apiKey: MARKER });
              expect(Date.parse(issued.expiresAt) - Date.parse(issued.issuedAt)).toEqual(45 * 60_000);
              expect(writes.length).toEqual(2);
              expect(JSON.stringify(writes).includes(MARKER)).toEqual(false);
              expect(logs.join('\n').includes(MARKER)).toEqual(false);
              expect(JSON.stringify(await service.deliveryState()).includes(MARKER)).toEqual(false);
            } finally {
              for (const restore of silenced) restore();
            }
          }),
      },
      {
        name: 'invalidation: a rotation changes the version, and revoke-all advances the epoch the heartbeat reports',
        run: async (_report, expect) =>
          withSigningKey(async () => {
            const before = nodeCredentialVersion(PURPOSE, { material: { apiKey: 'one' } });
            expect(nodeCredentialVersion(PURPOSE, { material: { apiKey: 'two' } }) === before).toEqual(false);
            const { service } = harness(ON);
            const { epoch } = await service.revokeAll('admin');
            expect(epoch).toEqual(2);
            expect((await service.deliveryState()).epoch).toEqual(2);
          }),
      },
    ];
  },
};

if (!conformanceSuites.has(nodeCredentialCacheConformanceSuite.id)) conformanceSuites.register(nodeCredentialCacheConformanceSuite);
