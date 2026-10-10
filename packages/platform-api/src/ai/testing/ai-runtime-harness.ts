// =============================================================================
// A wired AI runtime for unit tests (issue #432). TEST-ONLY.
//
// The REAL `AiService`, `AiConfigService`, `AiKeyResolver`,
// `UsableModelsService`, `AiUsageRecorder` and `AiRunsService`, over:
//
//   - `FakeAiProvider` registered as `openai`, recording every call and the key it carried,
//     with its embeddings, images, audio and realtime ports on and classifying each model
//     exactly as the catalog row below does;
//   - the REAL `AiStorageInputResolver` and `AiOutputWriter` (#437) over the
//     in-memory object storage from `in-memory-ai-storage.ts`;
//   - the in-memory key/model tables from `in-memory-ai-keys-prisma.ts`,
//     extended with `user_settings`, `ai_usage_events` and `ai_runs`;
//   - a stubbed settings row, org credential and job queue;
//   - optionally the provider an app or package adds (`extraProviders`,
//     `extraAdapters`, models and keys with a `provider`), so its author can
//     run the gate pipeline (kill switch, key policy, limits, usage) over it.
//
// So a gate test exercises the same code path production does, and "the
// org key was never used" is a fact about the fake's recorded calls rather
// than about a mock's expectations. Reusable by the HTTP surface (#433).
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { Job } from '../../jobs/index';

import { AiConfigService, type AiPolicy, type AiProviderPolicy } from '../config/ai-config.service';
import type { AiModelCapabilities } from '../core/capabilities';
import type { AiProviderAdapter } from '../core/provider-adapter.interface';
import { AiProviderRegistry } from '../core/provider-registry';
import { aiProviderKind, defaultAiProviderSlot, registerAiProvider, type AiProviderDefinition } from '../providers/ai-provider-definition';
import { AiKeyResolver } from '../keys/ai-key-resolver.service';
import { UsableModelsService } from '../keys/usable-models.service';
import type { AiTargetResolver } from '../runtime/target-resolver';
import { AiService } from '../runtime/ai.service';
import { AiLimitsService, type AiLimitsClock } from '../runtime/ai-limits.service';
import { AiRunsService, type AiRunsInOrg } from '../runtime/ai-runs.service';
import { AiUsageRecorder } from '../runtime/ai-usage.recorder';
import { AiOutputWriter } from '../storage/ai-output-writer';
import { AiStorageInputResolver } from '../storage/ai-storage-input.resolver';
import {
  FAKE_EMBEDDING_MODEL_CAPABILITIES,
  FAKE_IMAGE_MODEL_CAPABILITIES,
  FAKE_REALTIME_MODEL_CAPABILITIES,
  FAKE_SPEECH_MODEL_CAPABILITIES,
  FAKE_TEXT_MODEL_CAPABILITIES,
  FAKE_TRANSCRIPTION_MODEL_CAPABILITIES,
  FakeAiProvider,
  type FakeAiProviderOptions,
} from './fake-ai-provider';
import { createInMemoryAiKeysPrisma } from './in-memory-ai-keys-prisma';
import { createInMemoryAiStorage, type InMemoryAiStorage } from './in-memory-ai-storage';

/**
 * The harness's user (a canonical UUID); holds `HARNESS_USER_KEY` by default.
 *
 * @stability experimental
 */
export const HARNESS_USER = '11111111-1111-4111-8111-111111111111';
/**
 * A second user, with no key.
 *
 * @stability experimental
 */
export const HARNESS_OTHER_USER = '22222222-2222-4222-8222-222222222222';
/**
 * The organization every harness call runs in (the single-mode default).
 *
 * @stability experimental
 */
export const HARNESS_ORG = '33333333-3333-4333-8333-333333333333';
/**
 * `HARNESS_USER`'s own key: a sentinel that must never leave the server.
 *
 * @stability experimental
 */
export const HARNESS_USER_KEY = 'sk-user-own-key-1111';
/**
 * The deployment's key (historically named "org"), stored when `orgKey: true`: a sentinel.
 *
 * @stability experimental
 */
export const HARNESS_ORG_KEY = 'sk-org-admin-key-9999';
/**
 * An ORGANIZATION's own key (#739, the org tier), as `setTenantKey` stores
 * it: a sentinel that must never appear in a response, log line or row.
 * (`HARNESS_ORG_KEY` is the deployment's key, historically named "org".)
 *
 * @stability experimental
 */
export const HARNESS_TENANT_KEY = 'sk-org-tenant-key-7777';
/**
 * The fake provider's id (the settings slot it uses).
 *
 * @stability experimental
 */
export const HARNESS_PROVIDER = 'openai';
/**
 * The default catalog's fully capable text model.
 *
 * @stability experimental
 */
export const HARNESS_MODEL = 'fake-model';
/**
 * The default catalog's embedding model (`FAKE_EMBEDDING_MODEL_CAPABILITIES`).
 *
 * @stability experimental
 */
export const HARNESS_EMBEDDING_MODEL = 'fake-embedding-model';
/**
 * The default catalog's image model (`FAKE_IMAGE_MODEL_CAPABILITIES`: generate + edit).
 *
 * @stability experimental
 */
export const HARNESS_IMAGE_MODEL = 'fake-image-model';
/**
 * The default catalog's transcription model (`FAKE_TRANSCRIPTION_MODEL_CAPABILITIES`).
 *
 * @stability experimental
 */
export const HARNESS_TRANSCRIPTION_MODEL = 'fake-transcription-model';
/**
 * The default catalog's speech model (`FAKE_SPEECH_MODEL_CAPABILITIES`: voices alloy, echo).
 *
 * @stability experimental
 */
export const HARNESS_SPEECH_MODEL = 'fake-speech-model';
/**
 * The default catalog's realtime model (`FAKE_REALTIME_MODEL_CAPABILITIES`: voices marin, alloy).
 *
 * @stability experimental
 */
export const HARNESS_REALTIME_MODEL = 'fake-realtime-model';

/**
 * One catalog row of the harness.
 *
 * @stability experimental
 */
export interface HarnessModel {
  /** Model id. */
  modelId: string;
  /** The provider the row belongs to. Default: the fake provider (`HARNESS_PROVIDER`). */
  provider?: string;
  /** Its capabilities (text responses by default). */
  capabilities?: AiModelCapabilities;
  /** Whether it is enabled (default true). */
  enabled?: boolean;
  /** When the provider stopped listing it (default never). */
  deprecatedAt?: Date | null;
}

/**
 * Options of {@link createAiRuntimeHarness}.
 *
 * @stability experimental
 */
export interface AiRuntimeHarnessOptions {
  /** Merged over an enabled, byok, openai-on, no-cap policy. */
  policy?: Partial<Omit<AiPolicy, 'providers' | 'defaults' | 'hostedTools'>> & {
    /** Merged over every hosted tool switched off. */
    hostedTools?: Partial<AiPolicy['hostedTools']>;
    /** Whether the fake's (`openai`) slot is enabled (default true). */
    providerEnabled?: boolean;
    /** The fake's endpoint override. */
    baseUrl?: string;
    /**
     * Extra settings on the fake's (`openai`) slot — the #448 fields
     * (`apiStyle`, `requiresKey`, ...), which the runtime reads generically
     * off whichever slot a provider has.
     */
    providerSlot?: Omit<AiProviderPolicy, 'enabled' | 'baseUrl'>;
    /** Merged over background runs on, realtime off. */
    defaults?: Partial<AiPolicy['defaults']>;
  };
  /** Whether `HARNESS_USER` has a key (for the fake provider, and for each extra provider). Default true. */
  userKey?: boolean;
  /** Models the fake provider's user key reaches. Default: every catalog model of the fake provider. */
  reachable?: string[];
  /**
   * Providers an app or package adds (PP-14.6): each is registered with
   * `registerAiProvider` when it is not yet (the registry is process-wide, so a
   * definition the test file already registered is reused), gets an enabled
   * slot with its defaults, and, with `userKey`, a `HARNESS_USER` key reaching
   * its models. Pair each with an adapter in {@link AiRuntimeHarnessOptions.extraAdapters}
   * and catalog rows in {@link AiRuntimeHarnessOptions.models}.
   */
  extraProviders?: AiProviderDefinition[];
  /**
   * Adapters registered besides the fake provider, normally one per extra
   * provider (the app's own adapter over a fake transport).
   */
  extraAdapters?: AiProviderAdapter[];
  /**
   * Settings of the extra providers' slots, by provider id, merged over each
   * definition's defaults (`{ 'example-transcribe': { region: 'eu' } }`).
   */
  extraProviderSettings?: Record<string, Record<string, unknown>>;
  /** Whether an org key is stored. Default false. */
  orgKey?: boolean;
  /**
   * Catalog rows. Default: a fully capable `fake-model`, `fake-embedding-model`,
   * `fake-image-model`, `fake-transcription-model`, `fake-speech-model` and
   * `fake-realtime-model`. A row with a `provider` belongs to that provider.
   */
  models?: HarnessModel[];
  /** Options of the `FakeAiProvider` (scripts, ports, ...). */
  fake?: FakeAiProviderOptions;
  /** `HARNESS_USER`'s `ai.defaultModel` setting. Default none. */
  defaultModel?: {
    /** Provider id. */
    provider: string;
    /** Model id. */
    modelId: string;
  } | null;
  /** Register the fake provider at all. Default true. */
  registerProvider?: boolean;
  /**
   * The clock `AiLimitsService` reads and usage rows are stamped with (#450).
   * Default: the real `Date.now`.
   */
  clock?: AiLimitsClock;
  /**
   * The `AI_TARGET_RESOLVER` binding (#739). Default: none, so the service
   * uses `DefaultAiTargetResolver` (the base behaviour).
   */
  targetResolver?: AiTargetResolver;
}

/**
 * An `ai_runs` row in the harness's store.
 *
 * @stability experimental
 */
export interface StoredAiRun {
  /** Row id. */
  id: string;
  /** The owner. */
  userId: string | null;
  /** The queue job. */
  jobId: string | null;
  /** The run's status. */
  status: string;
  /** Provider id. */
  provider: string;
  /** Model id. */
  modelId: string;
  /** The stored request. */
  request: unknown;
  /** The stored output. */
  output: unknown;
  /** The failure's code. */
  errorCode: string | null;
  /** The failure's message. */
  errorMessage: string | null;
  /** Created. */
  createdAt: Date;
  /** Last change. */
  updatedAt: Date;
  /** When it settled. */
  completedAt: Date | null;
}

/**
 * A wired AI runtime for unit tests: the real services over a scripted fake
 * provider and in-memory tables, storage, settings and queue. Returned by
 * {@link createAiRuntimeHarness}.
 *
 * @stability experimental
 */
export interface AiRuntimeHarness {
  /** The real `AiService`. */
  ai: AiService;
  /** The fake provider, registered as `openai`; its `calls` record every call and key. */
  fake: FakeAiProvider;
  /** The provider registry. */
  registry: AiProviderRegistry;
  /** The real `AiConfigService` over the harness policy. */
  aiConfig: AiConfigService;
  /** The real key resolver. */
  resolver: AiKeyResolver;
  /** The real usable-models service. */
  usableModels: UsableModelsService;
  /** The real usage recorder (rows land in `usageEvents`). */
  recorder: AiUsageRecorder;
  /** The real runs service (rows land in `runRows`). */
  runs: AiRunsService;
  /**
   * The run state machine in `HARNESS_ORG`: what the run handlers see.
   *
   * @internal
   */
  orgRuns: AiRunsInOrg;
  /** The real storage-input resolver. */
  inputs: AiStorageInputResolver;
  /** The real output writer. */
  outputs: AiOutputWriter;
  /** The real limits service, on the harness clock. */
  limits: AiLimitsService;
  /** The in-memory object storage. */
  storage: InMemoryAiStorage;
  /** The in-memory client (`jest.fn` delegates). */
  prisma: any;
  /** The stub queue: `enqueueWithin` records into `enqueued`. */
  jobs: {
    /** Records the job and returns it. */
    enqueueWithin: jest.Mock;
  };
  /** The live policy object (`setPolicy` changes it). */
  policy: AiPolicy;
  /** Every recorded usage row, in order. */
  usageEvents: Array<Record<string, any>>;
  /** Every stored run. */
  runRows: StoredAiRun[];
  /** Every enqueued job. */
  enqueued: Array<Record<string, any>>;
  /** The credential store's `getSecret` stub (answers the deployment key). */
  getSecret: jest.Mock;
  /** The user-key store's stub (`getDecrypted`). */
  userKeys: {
    /** Answers the user's stored key for the provider. */
    getDecrypted: jest.Mock;
  };
  /**
   * Stores a key for `userId`.
   *
   * @param userId - the owner.
   * @param secret - the key (stored as-is).
   * @param reachable - the model ids it reaches.
   * @param provider - the provider it is for (default: the fake provider).
   */
  addUserKey(userId: string, secret: string, reachable: string[], provider?: string): void;
  /**
   * Removes every key `userId` has stored.
   *
   * @param userId - the owner.
   */
  removeUserKeys(userId: string): void;
  /**
   * Changes the policy; the config cache is dropped so the next call sees it.
   *
   * @param patch - the fields to change.
   */
  setPolicy(patch: Partial<AiPolicy>): void;
  /**
   * Stores (or, with `null`, removes) the deployment's key.
   *
   * @param value - the key.
   */
  setOrgKey(value: string | null): void;
  /**
   * Sets (or, with `null`, clears) an organization's own `ai` overrides, its
   * org layer (#739): `{ enabled: false }` switches AI off for its members.
   *
   * @param orgId - the organization.
   * @param overrides - the overrides.
   */
  setOrgPolicy(orgId: string, overrides: Record<string, unknown> | null): void;
  /** Clears every organization's overrides. */
  clearOrgPolicies(): void;
  /** The permission lookups' stubs (`holdsAiConfigWrite`, `holdsOrgAiConfigWrite`). */
  configWriters: {
    /** Whether a user holds `ai_config:write`. */
    holdsAiConfigWrite: jest.Mock;
    /** Whether a user holds `org_ai_config:write` in an organization. */
    holdsOrgAiConfigWrite: jest.Mock;
  };
  /**
   * Grants (true) or revokes (false) `ai_config:write` for `userId` (#593).
   *
   * @param userId - the user.
   * @param holds - whether they hold it.
   */
  setAiConfigWriter(userId: string, holds: boolean): void;
  /** Nobody holds `ai_config:write` or `org_ai_config:write` any more (the default). */
  clearAiConfigWriters(): void;
  /** The organization-key store's stubs (`getKey`, `hasKey`). */
  orgKeys: {
    /** An organization's key for a provider, or null. */
    getKey: jest.Mock;
    /** Whether an organization stores a key for a provider. */
    hasKey: jest.Mock;
  };
  /**
   * Stores (or, with `null`, removes) an organization's own key for a provider (#739).
   *
   * @param orgId - the organization.
   * @param value - the key.
   * @param provider - the provider it is for (default: the fake provider).
   */
  setTenantKey(orgId: string, value: string | null, provider?: string): void;
  /** Removes every organization's own key. */
  clearTenantKeys(): void;
  /**
   * Grants (true) or revokes (false) `org_ai_config:write` for `userId` in `orgId` (#739).
   *
   * @param userId - the user.
   * @param orgId - the organization.
   * @param holds - whether they hold it.
   */
  setOrgAiConfigWriter(userId: string, orgId: string, holds: boolean): void;
  /**
   * Sets (or clears) `userId`'s `ai.defaultModel`.
   *
   * @param userId - the user.
   * @param value - the model, or null.
   */
  setDefaultModel(
    userId: string,
    value: {
      /** Provider id. */
      provider: string;
      /** Model id. */
      modelId: string;
    } | null,
  ): void;
}

type Where = Record<string, any>;

function matchesRun(row: StoredAiRun, where: Where = {}): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = (row as unknown as Record<string, unknown>)[key];

    if (expected && typeof expected === 'object' && 'in' in expected) {
      if (!(expected.in as unknown[]).includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }

  return true;
}

/**
 * The `ai_usage_events` filters `AiLimitsService` uses: equality, `{ in }`,
 * and `{ gt }` / `{ gte }` on a Date column.
 */
function matchesUsage(row: Record<string, any>, where: Where = {}): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = row[key];

    if (expected instanceof Date) {
      if (!(actual instanceof Date) || actual.getTime() !== expected.getTime()) return false;
    } else if (expected && typeof expected === 'object') {
      if ('in' in expected && !(expected.in as unknown[]).includes(actual)) return false;
      if ('gte' in expected && !(actual instanceof Date && actual.getTime() >= (expected.gte as Date).getTime())) {
        return false;
      }
      if ('gt' in expected && !(actual instanceof Date && actual.getTime() > (expected.gt as Date).getTime())) {
        return false;
      }
      if ('not' in expected && actual === expected.not) return false;
    } else if (actual !== expected) {
      return false;
    }
  }

  return true;
}

function pick(row: object, select?: Record<string, boolean>): Record<string, unknown> {
  const source = row as Record<string, unknown>;

  if (!select) return { ...source };

  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, source[k]]));
}

/**
 * Builds the real AI runtime over a scripted fake provider and in-memory
 * tables, so a gate test exercises the production code path and "the
 * deployment key was never used" is a fact about the fake's recorded calls.
 *
 * @param opts - the policy, keys, catalog and fake's options.
 * @returns the harness.
 *
 * @stability experimental
 */
export function createAiRuntimeHarness(opts: AiRuntimeHarnessOptions = {}): AiRuntimeHarness {
  const db = createInMemoryAiKeysPrisma();
  const usageEvents: Array<Record<string, any>> = [];
  const clock: AiLimitsClock = opts.clock ?? (() => Date.now());
  const runRows: StoredAiRun[] = [];
  const enqueued: Array<Record<string, any>> = [];
  const settings = new Map<string, unknown>();

  const models = opts.models ?? [
    { modelId: HARNESS_MODEL },
    { modelId: HARNESS_EMBEDDING_MODEL, capabilities: FAKE_EMBEDDING_MODEL_CAPABILITIES },
    { modelId: HARNESS_IMAGE_MODEL, capabilities: FAKE_IMAGE_MODEL_CAPABILITIES },
    { modelId: HARNESS_TRANSCRIPTION_MODEL, capabilities: FAKE_TRANSCRIPTION_MODEL_CAPABILITIES },
    { modelId: HARNESS_SPEECH_MODEL, capabilities: FAKE_SPEECH_MODEL_CAPABILITIES },
    { modelId: HARNESS_REALTIME_MODEL, capabilities: FAKE_REALTIME_MODEL_CAPABILITIES },
  ];

  for (const model of models) {
    db.addModel({
      provider: model.provider ?? HARNESS_PROVIDER,
      modelId: model.modelId,
      capabilities: model.capabilities ?? FAKE_TEXT_MODEL_CAPABILITIES,
      enabled: model.enabled ?? true,
      deprecatedAt: model.deprecatedAt ?? null,
    });
  }

  const addUserKey = (userId: string, secret: string, reachable: string[], provider: string = HARNESS_PROVIDER) => {
    db.keys.push({
      id: randomUUID(),
      userId,
      provider,
      secret,
      hint: null,
      verifiedAt: new Date(),
      lastErrorCode: null,
      reachableModelIds: reachable,
      reachableCheckedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  };

  const modelsOf = (provider: string) => models.filter((m) => (m.provider ?? HARNESS_PROVIDER) === provider).map((m) => m.modelId);

  if (opts.userKey ?? true) {
    addUserKey(HARNESS_USER, HARNESS_USER_KEY, opts.reachable ?? modelsOf(HARNESS_PROVIDER));
  }

  for (const definition of opts.extraProviders ?? []) {
    if (!aiProviderKind.has(definition.id)) registerAiProvider(definition);
    if (opts.userKey ?? true) addUserKey(HARNESS_USER, `${HARNESS_USER_KEY}-${definition.id}`, modelsOf(definition.id), definition.id);
  }

  if (opts.defaultModel) {
    settings.set(HARNESS_USER, { theme: 'system', ai: { defaultModel: opts.defaultModel } });
  }

  const p = opts.policy ?? {};
  const policy: AiPolicy = {
    enabled: p.enabled ?? true,
    keyPolicy: p.keyPolicy ?? 'byok',
    providers: {
      openai: {
        enabled: p.providerEnabled ?? true,
        ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
        ...(p.providerSlot ?? {}),
      } as AiPolicy['providers']['openai'],
      anthropic: { enabled: false },
      gemini: { enabled: false },
      'azure-openai': { enabled: false },
      'openai-compatible': { enabled: false },
      ...Object.fromEntries(
        (opts.extraProviders ?? []).map((definition) => [
          definition.id,
          { ...defaultAiProviderSlot(definition.id), enabled: true, ...(opts.extraProviderSettings?.[definition.id] ?? {}) },
        ]),
      ),
    },
    defaults: { allowBackgroundRuns: true, allowRealtime: false, ...(p.defaults ?? {}) },
    logPromptContent: p.logPromptContent ?? false,
    usageRetentionDays: 180,
    hostedTools: {
      web_search: false,
      file_search: false,
      code_interpreter: false,
      image_generation: false,
      mcp: false,
      mcpAllowedHosts: [],
      ...(p.hostedTools ?? {}),
    },
    limits: p.limits ?? {},
    deploymentKeyServesOrgs: p.deploymentKeyServesOrgs ?? true,
  };

  let orgKey: string | null = opts.orgKey ? HARNESS_ORG_KEY : null;
  const getSecret = jest.fn(async () => orgKey);
  const describe_ = jest.fn(async () => (orgKey ? { hint: '••••9999' } : null));

  const storage = createInMemoryAiStorage();

  const prisma: any = {
    ...db.prisma,
    ...storage.prisma,
    userSettings: {
      findUnique: jest.fn(async (args: { where: { userId: string } }) => {
        const value = settings.get(args.where.userId);
        return value === undefined ? null : { value };
      }),
    },
    aiUsageEvent: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const row = { id: randomUUID(), createdAt: new Date(clock()), ...args.data };
        usageEvents.push(row);
        return row;
      }),
      // The reads `AiLimitsService` makes (#450).
      count: jest.fn(
        async (args: { where?: Where } = {}) => usageEvents.filter((r) => matchesUsage(r, args.where)).length,
      ),
      findMany: jest.fn(
        async (
          args: {
            where?: Where;
            orderBy?: { createdAt: 'asc' | 'desc' };
            skip?: number;
            take?: number;
            select?: Record<string, boolean>;
          } = {},
        ) => {
          const rows = usageEvents.filter((r) => matchesUsage(r, args.where));

          if (args.orderBy?.createdAt) {
            const dir = args.orderBy.createdAt === 'asc' ? 1 : -1;
            rows.sort((a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()));
          }

          const skip = args.skip ?? 0;
          const page = rows.slice(skip, args.take === undefined ? undefined : skip + args.take);

          return page.map((r) => pick(r, args.select));
        },
      ),
      aggregate: jest.fn(async (args: { where?: Where; _sum?: Record<string, boolean> }) => {
        const rows = usageEvents.filter((r) => matchesUsage(r, args.where));
        const _sum: Record<string, number | null> = {};

        for (const field of Object.keys(args._sum ?? {})) {
          const values = rows.map((r) => r[field]).filter((v): v is number => typeof v === 'number');
          _sum[field] = values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
        }

        return { _sum };
      }),
    },
    aiRun: {
      create: jest.fn(async (args: { data: Partial<StoredAiRun>; select?: Record<string, boolean> }) => {
        const now = new Date();
        const row: StoredAiRun = {
          id: randomUUID(),
          userId: null,
          jobId: null,
          status: 'pending',
          provider: '',
          modelId: '',
          request: null,
          output: null,
          errorCode: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          ...args.data,
        };
        runRows.push(row);
        return pick(row, args.select);
      }),
      update: jest.fn(async (args: { where: { id: string }; data: Partial<StoredAiRun> }) => {
        const row = runRows.find((r) => r.id === args.where.id);
        if (!row) throw new Error('aiRun.update: not found');
        Object.assign(row, args.data, { updatedAt: new Date() });
        return { ...row };
      }),
      updateMany: jest.fn(async (args: { where: Where; data: Partial<StoredAiRun> }) => {
        const rows = runRows.filter((r) => matchesRun(r, args.where));
        for (const row of rows) Object.assign(row, args.data, { updatedAt: new Date() });
        return { count: rows.length };
      }),
      findFirst: jest.fn(async (args: { where: Where; select?: Record<string, boolean> }) => {
        const row = runRows.find((r) => matchesRun(r, args.where));
        return row ? pick(row, args.select) : null;
      }),
      findUnique: jest.fn(async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = runRows.find((r) => r.id === args.where.id);
        return row ? pick(row, args.select) : null;
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma)),
    // Organization scope (#725): the in-memory tables have no row-level
    // security, so a scoped client is the client itself. The default
    // organization answers the single-mode fallback for legacy callers.
    forOrg: jest.fn(() => prisma),
    runInOrg: jest.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => prisma.$transaction(fn)),
    organization: { findFirst: jest.fn(async () => ({ id: HARNESS_ORG })) },
  };

  const jobs = {
    enqueueWithin: jest.fn(async (_tx: unknown, input: Record<string, any>) => {
      const job = { id: randomUUID(), status: 'pending', ...input } as unknown as Job;
      enqueued.push(job as unknown as Record<string, any>);
      return job;
    }),
  };

  const registry = new AiProviderRegistry();
  const catalogCapabilities = new Map(
    models.map((m) => [m.modelId, m.capabilities ?? FAKE_TEXT_MODEL_CAPABILITIES] as const),
  );
  const fake = new FakeAiProvider({
    id: HARNESS_PROVIDER,
    models: models.map((m) => m.modelId),
    classify: (modelId) => catalogCapabilities.get(modelId) ?? null,
    embeddingsPort: true,
    imagesPort: true,
    audioPort: true,
    realtimePort: true,
    ...opts.fake,
  });

  if (opts.registerProvider ?? true) {
    registry.register(fake);
  }

  for (const adapter of opts.extraAdapters ?? []) registry.register(adapter);

  // #739: each organization's stored `ai` overrides (its org layer), by org id.
  const orgLayers = new Map<string, Record<string, unknown>>();
  const orgSettings = {
    isEnabled: () => true,
    getNamespace: jest.fn(async (orgId: string, key: string) => (key === 'ai' ? orgLayers.get(orgId) : undefined)),
  };
  const aiConfig = new AiConfigService(
    { getAiPolicy: jest.fn(async () => policy) } as never,
    { getSecret, describe: describe_ } as never,
    registry,
    orgSettings as never,
  );
  const userKeys = {
    getDecrypted: jest.fn(async (userId: string, provider: string) =>
      db.keys.find((k) => k.userId === userId && k.provider === provider)?.secret ?? null,
    ),
  };
  // Who holds `ai_config:write` (#593, resolver rule 2). Nobody by default, so
  // every suite that predates the rule keeps its non-administrator semantics.
  const aiConfigWriters = new Set<string>();
  const configWriters = {
    holdsAiConfigWrite: jest.fn(async (userId: string) => aiConfigWriters.has(userId)),
    // #739: `org_ai_config:write` in one organization, as `userId|orgId`.
    holdsOrgAiConfigWrite: jest.fn(async (userId: string, orgId: string) => orgConfigWriters.has(`${userId}|${orgId}`)),
  };
  // #739: each organization's own key for the fake provider, by org id.
  const tenantKeys = new Map<string, string>();
  const tenantKeyId = (orgId: string, provider: string) => `${orgId}|${provider}`;
  const orgKeys = {
    getKey: jest.fn(async (orgId: string, provider: string) => tenantKeys.get(tenantKeyId(orgId, provider)) ?? null),
    hasKey: jest.fn(async (orgId: string, provider: string) => tenantKeys.has(tenantKeyId(orgId, provider))),
  };
  const orgConfigWriters = new Set<string>();
  const resolver = new AiKeyResolver(userKeys as never, aiConfig, configWriters as never, orgKeys as never);
  const usableModels = new UsableModelsService(prisma as never, aiConfig, registry, resolver);
  const recorder = new AiUsageRecorder(prisma as never);
  const runs = new AiRunsService(prisma as never, jobs as never);
  // The run state machine in the harness organization: what the handlers see.
  const orgRuns = runs.forOrg(HARNESS_ORG);
  const inputs = new AiStorageInputResolver(prisma as never, storage.store);
  const outputs = new AiOutputWriter(prisma as never, storage.store);
  const limits = new AiLimitsService(prisma as never, aiConfig, clock);
  const ai = new AiService(
    aiConfig,
    registry,
    usableModels,
    resolver,
    prisma as never,
    recorder,
    runs,
    inputs,
    outputs,
    limits,
    opts.targetResolver,
  );

  return {
    ai,
    fake,
    registry,
    aiConfig,
    resolver,
    usableModels,
    recorder,
    runs,
    orgRuns,
    inputs,
    outputs,
    limits,
    storage,
    prisma,
    jobs,
    policy,
    usageEvents,
    runRows,
    enqueued,
    getSecret,
    userKeys,
    addUserKey,
    /** Remove every key `userId` has stored. */
    removeUserKeys(userId: string) {
      for (let i = db.keys.length - 1; i >= 0; i -= 1) {
        if (db.keys[i].userId === userId) db.keys.splice(i, 1);
      }
    },
    /** Change the policy; the config cache is dropped so the next call sees it. */
    setPolicy(patch: Partial<AiPolicy>) {
      Object.assign(policy, patch);
      aiConfig.invalidateCache();
    },
    setOrgKey(value: string | null) {
      orgKey = value;
    },
    /**
     * Set (or, with `null`, clear) an organization's own `ai` overrides, its
     * org layer (#739): `{ enabled: false }` switches AI off for its members.
     */
    setOrgPolicy(orgId: string, overrides: Record<string, unknown> | null) {
      if (overrides) orgLayers.set(orgId, overrides);
      else orgLayers.delete(orgId);
      aiConfig.invalidateCache();
    },
    /** Clear every organization's overrides. */
    clearOrgPolicies() {
      orgLayers.clear();
      aiConfig.invalidateCache();
    },
    configWriters,
    /** Grant (true) or revoke (false) `ai_config:write` for `userId` (#593). */
    setAiConfigWriter(userId: string, holds: boolean) {
      if (holds) aiConfigWriters.add(userId);
      else aiConfigWriters.delete(userId);
    },
    /** Nobody holds `ai_config:write` any more (the default). */
    clearAiConfigWriters() {
      aiConfigWriters.clear();
      orgConfigWriters.clear();
    },
    orgKeys,
    /** Store (or, with `null`, remove) an organization's own key for a provider (#739). */
    setTenantKey(orgId: string, value: string | null, provider: string = HARNESS_PROVIDER) {
      if (value === null) tenantKeys.delete(tenantKeyId(orgId, provider));
      else tenantKeys.set(tenantKeyId(orgId, provider), value);
    },
    /** Remove every organization's own key. */
    clearTenantKeys() {
      tenantKeys.clear();
    },
    /** Grant (true) or revoke (false) `org_ai_config:write` for `userId` in `orgId` (#739). */
    setOrgAiConfigWriter(userId: string, orgId: string, holds: boolean) {
      if (holds) orgConfigWriters.add(`${userId}|${orgId}`);
      else orgConfigWriters.delete(`${userId}|${orgId}`);
    },
    setDefaultModel(userId: string, value: { provider: string; modelId: string } | null) {
      settings.set(userId, { theme: 'system', ai: { defaultModel: value } });
    },
  };
}

