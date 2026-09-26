// =============================================================================
// AI model catalog (issue #427, epic #419)
// =============================================================================
//
// Discovers one provider's models with the ADMIN key, classifies each through
// the adapter's own `classifyModel`, and persists the result in `ai_models`.
// See docs/specs/ai-platform.md §6 for the rules this file implements.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Job } from '@prisma/client';

import { CredentialsService } from '../../credentials/credentials.service';
import { JobsService } from '../../jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemSettingsService } from '../../settings/system-settings/system-settings.service';
import { AiProviderRegistry } from '../core/provider-registry';
import { AI_CREDENTIAL_PURPOSE, aiCredentialName } from './ai-credential.constants';

/** The job type that runs {@link AiCatalogService.sync} for one provider. PERMANENT. */
export const AI_CATALOG_REFRESH_TYPE = 'ai.catalog.refresh';

/** The `subjectType` every catalog refresh job carries; the subject id is the provider id. */
export const AI_CATALOG_SUBJECT_TYPE = 'ai_provider';

/**
 * Why a sync did nothing. Each is an ordinary, expected outcome — not a
 * failure — so the refresh job returns normally on every one of them.
 */
export type AiCatalogSkipReason =
  | 'AI_DISABLED'
  | 'AI_PROVIDER_DISABLED'
  | 'NO_ADMIN_KEY'
  | 'PROVIDER_NOT_REGISTERED';

export interface AiCatalogSyncCounts {
  /** Rows inserted: models this deployment had never seen. */
  added: number;
  /** Existing rows whose capabilities changed or that reappeared after deprecation. */
  updated: number;
  /** Rows newly marked deprecated because the provider no longer lists them. */
  deprecated: number;
  /** Distinct model ids the provider returned. */
  total: number;
}

export type AiCatalogSyncResult = AiCatalogSyncCounts | { skipped: AiCatalogSkipReason };

export interface AiCatalogSyncOptions {
  /** The administrator who asked for this sync, when one did. Recorded in the audit row. */
  actorUserId?: string | null;
  /** The queue job this sync runs under, recorded on the usage row. */
  jobId?: string | null;
}

/** Narrows a sync result to its skipped arm. */
export function isCatalogSyncSkipped(
  result: AiCatalogSyncResult,
): result is { skipped: AiCatalogSkipReason } {
  return 'skipped' in result;
}

/** The policy slice a provider carries in the `ai` namespace. */
interface AiProviderPolicy {
  enabled: boolean;
  baseUrl?: string;
}

@Injectable()
export class AiCatalogService {
  private readonly logger = new Logger(AiCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemSettings: SystemSettingsService,
    private readonly credentials: CredentialsService,
    private readonly registry: AiProviderRegistry,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Queues a catalog refresh for `providerId`. Deduplicated by the queue on
   * type + subject, so asking twice while one is pending returns that job.
   */
  async enqueueRefresh(providerId: string, actorUserId?: string | null): Promise<Job> {
    return this.jobs.enqueue({
      type: AI_CATALOG_REFRESH_TYPE,
      reason: 'rerun',
      subjectType: AI_CATALOG_SUBJECT_TYPE,
      subjectId: providerId,
      payload: actorUserId ? { providerId, actorUserId } : { providerId },
    });
  }

  /** Discovers, classifies and persists `providerId`'s model catalog. */
  async sync(providerId: string, _options: AiCatalogSyncOptions = {}): Promise<AiCatalogSyncResult> {
    const policy = await this.systemSettings.getAiPolicy();

    if (!policy.enabled) {
      return { skipped: 'AI_DISABLED' };
    }

    const providerPolicy = (policy.providers as Record<string, AiProviderPolicy | undefined>)[
      providerId
    ];

    if (!providerPolicy?.enabled) {
      return { skipped: 'AI_PROVIDER_DISABLED' };
    }

    if (!this.registry.get(providerId)) {
      return { skipped: 'PROVIDER_NOT_REGISTERED' };
    }

    const apiKey = await this.credentials.getSecret(
      AI_CREDENTIAL_PURPOSE,
      aiCredentialName(providerId),
    );

    if (!apiKey) {
      return { skipped: 'NO_ADMIN_KEY' };
    }

    // Discovery and persistence land in the next commit.
    this.logger.debug(`Catalog sync for "${providerId}" is not implemented yet`);

    return { added: 0, updated: 0, deprecated: 0, total: 0 };
  }
}
