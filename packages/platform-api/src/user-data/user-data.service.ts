// =============================================================================
// The three request services of the user-data slice (issue #743, PP-9.1)
// =============================================================================
//
// Each one validates the request, enqueues ONE job through `JobsService` (the
// queue's active dedup collapses a second request onto the job in flight;
// there is never a `findFirst` pre-check), records the `.requested` audit
// event, and reads a job back for its status route. The phrase is re-checked
// HERE, with a zod literal, so a `curl` caller gets the same guarantee as the
// browser.
// =============================================================================

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  FACTORY_RESET_JOB_TYPE,
  ORG_OFFBOARD_JOB_TYPE,
  USER_DATA_ERROR_CODES,
  USER_DATA_PURGE_JOB_TYPE,
  factoryResetResultSchema,
  orgOffboardingResultSchema,
  userDataPurgeResultSchema,
  type FactoryResetStatus,
  type FactoryResetSummary,
  type OffboardingPreconditionResult,
  type OffboardingUserDisposition,
  type OrgOffboardingStatus,
  type OrgOffboardingSummary,
  type UserDataDeletionStatus,
  type UserDataJobStarted,
  type UserDataJobStatus,
  type UserDataSummary,
} from '@marinoscar/platform-contract/user-data';
import { z } from 'zod';

import { AUDIT_SINK, type AuditSink } from '../core/index';
import { JobsService, type Job } from '../jobs/index';
import { survivingKeyPrefixes } from '../storage/index';
import { ORG_OFFBOARD_SUBJECT_TYPE } from './handlers/org-offboard.handler';
import { USER_DATA_DB, USER_DATA_ENVIRONMENT, type UserDataDbPort, type UserDataEnvironment } from './ports';
import { countUserData } from './purge/user-purge';
import { UserDataPlanService } from './user-data-plan.service';
import { USER_DATA_AUDIT_ACTIONS } from './user-data.metrics';
import { USER_DATA_OPTIONS, type ResolvedUserDataModuleOptions } from './user-data.options';
import {
  categoriesOfScope,
  findUserDataScope,
  offboardingPreconditionRegistry,
  resolvedUserDataScopes,
  userDataCategoryRegistry,
} from './user-data.registries';
import { USER_DATA_SUBJECT_TYPE, payloadOf } from './user-purge.runner';

/** A 4xx with `details.reason`, the envelope's place for an endpoint code. */
function reason<T extends new (body: object) => Error>(Exception: T, code: string, message: string, extra: object = {}): Error {
  return new Exception({ message, details: { reason: code, ...extra } });
}

function statusOf(job: Pick<Job, 'status'>): UserDataJobStatus {
  return job.status as UserDataJobStatus;
}

/** The parsed `payload.result` of a succeeded job, or `null`. */
function resultOf<S extends z.ZodTypeAny>(job: Pick<Job, 'status' | 'payload'>, schema: S): z.infer<S> | null {
  if (job.status !== 'succeeded') return null;
  const parsed = schema.safeParse(payloadOf(job).result);
  return parsed.success ? parsed.data : null;
}

/**
 * The per-user deletion: summary, request, status.
 *
 * @stability experimental
 */
@Injectable()
export class UserDataService {
  constructor(
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
    private readonly plans: UserDataPlanService,
    private readonly jobs: JobsService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  /**
   * What the caller owns per category, and the scopes they may request.
   *
   * @param userId - the caller.
   */
  async summary(userId: string): Promise<UserDataSummary> {
    const { counts, bytes } = await countUserData(this.db.system('admin-aggregate'), this.plans.user(), userId);
    return {
      categories: userDataCategoryRegistry.list().map((def) => ({
        id: def.id,
        label: def.label,
        description: def.description,
        content: def.content,
        count: counts[def.id] ?? 0,
        bytes: def.id in bytes ? bytes[def.id]! : null,
      })),
      scopes: resolvedUserDataScopes().map((def) => ({
        id: def.id,
        label: def.label,
        description: def.description,
        layer: def.layer,
        confirmation: def.confirmation,
        categories: categoriesOfScope(def),
      })),
    };
  }

  /**
   * Validates the scope and its phrase, enqueues `user.data.purge` (or
   * returns the purge already in flight for the caller) and audits it.
   *
   * @param userId - the caller.
   * @param body - `{ scope, confirmation }`.
   * @throws BadRequestException `UNKNOWN_SCOPE` or `CONFIRMATION_MISMATCH`.
   */
  async requestDeletion(userId: string, body: { scope: string; confirmation: string }): Promise<UserDataJobStarted> {
    const scope = findUserDataScope(body.scope);
    if (!scope) throw reason(BadRequestException, USER_DATA_ERROR_CODES.UNKNOWN_SCOPE, `No deletion scope "${body.scope}"`);
    if (!z.literal(scope.confirmation).safeParse(body.confirmation).success) {
      throw reason(BadRequestException, USER_DATA_ERROR_CODES.CONFIRMATION_MISMATCH, `Type exactly "${scope.confirmation}" to confirm`);
    }
    const job = await this.jobs.enqueue({
      type: USER_DATA_PURGE_JOB_TYPE,
      reason: 'rerun',
      subjectType: USER_DATA_SUBJECT_TYPE,
      subjectId: userId,
      payload: { userId, scope: scope.id },
      orgId: null,
    });
    await this.audit.record({
      action: USER_DATA_AUDIT_ACTIONS.PURGE_REQUESTED,
      actorUserId: userId,
      targetType: 'user',
      targetId: userId,
      meta: { jobId: job.id, status: job.status, scope: scope.id },
    });
    return { jobId: job.id, status: statusOf(job) };
  }

  /**
   * The caller's purge job.
   *
   * @param userId - the caller.
   * @param jobId - the job.
   * @throws NotFoundException for any other job, another user's included.
   */
  async status(userId: string, jobId: string): Promise<UserDataDeletionStatus> {
    const job: Job | null = await this.db.system('admin-aggregate').job.findFirst({
      where: { id: jobId, type: USER_DATA_PURGE_JOB_TYPE, subjectType: USER_DATA_SUBJECT_TYPE, subjectId: userId },
    });
    if (!job) throw new NotFoundException('Data deletion job not found');
    const payload = payloadOf(job);
    return {
      jobId: job.id,
      status: statusOf(job),
      scope: typeof payload.scope === 'string' ? payload.scope : '',
      result: resultOf(job, userDataPurgeResultSchema),
      error: job.status === 'failed' ? (job.lastError ?? 'The deletion failed') : null,
    };
  }
}

/**
 * The admin factory reset: summary, request, status.
 *
 * @stability experimental
 */
@Injectable()
export class FactoryResetService {
  constructor(
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
    @Inject(USER_DATA_ENVIRONMENT) private readonly environment: UserDataEnvironment,
    private readonly plans: UserDataPlanService,
    private readonly jobs: JobsService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Inject(USER_DATA_OPTIONS) private readonly options: ResolvedUserDataModuleOptions,
  ) {}

  /** `FACTORY_RESET_DISABLED_IN_SAAS` in `saas` mode, otherwise `null`. */
  disabledReason(): string | null {
    return this.environment.deploymentMode() === 'saas' ? USER_DATA_ERROR_CODES.FACTORY_RESET_DISABLED_IN_SAAS : null;
  }

  /** @throws ForbiddenException `FACTORY_RESET_DISABLED_IN_SAAS`. */
  assertAvailable(): void {
    if (this.disabledReason()) {
      throw reason(
        ForbiddenException,
        USER_DATA_ERROR_CODES.FACTORY_RESET_DISABLED_IN_SAAS,
        'The factory reset is disabled in SaaS mode; offboard organizations instead',
      );
    }
  }

  /**
   * Deployment-wide counts of what a reset deletes. Answers in `saas` mode
   * too, with `disabledReason`, so the page can say why.
   *
   * @param actorUserId - the caller (excluded from `otherUsers`).
   */
  async summary(actorUserId: string): Promise<FactoryResetSummary> {
    const db = this.db.system('admin-aggregate');
    const plan = this.plans.user();
    const surviving = survivingKeyPrefixes();
    const keptJobIds = await this.keptJobIds(db);
    const categories: Record<string, number> = {};
    for (const step of [...plan.steps, ...plan.delegated, ...(plan.storage ? [plan.storage] : [])]) {
      categories[step.category] = (categories[step.category] ?? 0) + (await db[step.delegate].count({ where: { [step.ownerField]: { not: null } } }));
    }
    const storageObjects = plan.storage
      ? await db[plan.storage.delegate].count({
          where: surviving.length > 0 ? { NOT: { OR: surviving.map((prefix) => ({ storageKey: { startsWith: prefix } })) } } : {},
        })
      : 0;
    return {
      disabledReason: this.disabledReason(),
      otherUsers: await db.user.count({ where: { id: { not: actorUserId } } }),
      organizations: db.organization ? await db.organization.count({ where: { isDefault: false } }) : 0,
      storageObjects,
      jobs: await db.job.count({ where: { status: { not: 'running' }, id: { notIn: keptJobIds } } }),
      categories: userDataCategoryRegistry.list().map((def) => ({ id: def.id, label: def.label, count: categories[def.id] ?? 0 })),
    };
  }

  /**
   * Enqueues the reset (or returns the one in flight) and audits it.
   *
   * @param actorUserId - the caller.
   * @throws ForbiddenException in `saas` mode.
   */
  async request(actorUserId: string): Promise<UserDataJobStarted> {
    this.assertAvailable();
    const job = await this.jobs.enqueue({ type: FACTORY_RESET_JOB_TYPE, reason: 'rerun', payload: { actorUserId }, orgId: null });
    await this.audit.record({
      action: USER_DATA_AUDIT_ACTIONS.FACTORY_RESET_REQUESTED,
      actorUserId,
      targetType: 'deployment',
      targetId: 'factory-reset',
      meta: { jobId: job.id, status: job.status },
    });
    return { jobId: job.id, status: statusOf(job) };
  }

  /**
   * A factory reset job's status.
   *
   * @param jobId - the job.
   * @throws NotFoundException for another job type.
   */
  async status(jobId: string): Promise<FactoryResetStatus> {
    this.assertAvailable();
    const job: Job | null = await this.db.system('admin-aggregate').job.findFirst({ where: { id: jobId, type: FACTORY_RESET_JOB_TYPE } });
    if (!job) throw new NotFoundException('Factory reset job not found');
    return {
      jobId: job.id,
      status: statusOf(job),
      result: resultOf(job, factoryResetResultSchema),
      error: job.status === 'failed' ? (job.lastError ?? 'The factory reset failed') : null,
    };
  }

  private async keptJobIds(db: any): Promise<string[]> {
    const ids: string[] = [];
    for (const ref of this.options.keepJobsReferencedBy) {
      const delegate = db[ref.model.charAt(0).toLowerCase() + ref.model.slice(1)];
      if (!delegate) continue;
      const rows: Record<string, unknown>[] = await delegate.findMany({ where: { [ref.field]: { not: null } }, select: { [ref.field]: true } });
      for (const row of rows) if (typeof row[ref.field] === 'string') ids.push(row[ref.field] as string);
    }
    return ids;
  }
}

/**
 * Organization offboarding: summary, request, status.
 *
 * @stability experimental
 */
@Injectable()
export class OrgOffboardingService {
  constructor(
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
    @Inject(USER_DATA_ENVIRONMENT) private readonly environment: UserDataEnvironment,
    private readonly plans: UserDataPlanService,
    private readonly jobs: JobsService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  /** @throws ConflictException `OFFBOARDING_REQUIRES_MULTI_ORG` in single mode. */
  private assertMultiOrg(): void {
    if (this.environment.tenancyMode() !== 'multi') {
      throw reason(
        ConflictException,
        USER_DATA_ERROR_CODES.OFFBOARDING_REQUIRES_MULTI_ORG,
        'Offboarding exists only in multi-organization mode (TENANCY_MODE=multi)',
      );
    }
  }

  private async org(orgId: string): Promise<{ id: string; name: string; slug: string; isDefault: boolean }> {
    const org = await this.db.system('admin-aggregate').organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, isDefault: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  private async preconditions(orgId: string): Promise<OffboardingPreconditionResult[]> {
    const db = this.db.system('admin-aggregate');
    const out: OffboardingPreconditionResult[] = [];
    for (const def of offboardingPreconditionRegistry.list()) {
      const verdict = await def.check({ orgId }, db);
      out.push({ id: def.id, label: def.label, passed: verdict.passed === true, message: verdict.message ?? null });
    }
    return out;
  }

  /**
   * What offboarding the organization deletes, and whether it may.
   *
   * @param orgId - the organization.
   * @throws ConflictException in single mode; NotFoundException for an unknown organization.
   */
  async summary(orgId: string): Promise<OrgOffboardingSummary> {
    this.assertMultiOrg();
    const org = await this.org(orgId);
    const db = this.db.system('admin-aggregate');
    const orgPlan = this.plans.org();
    const models: Record<string, number> = {};
    for (const step of orgPlan.steps) models[step.model] = await db[step.delegate].count({ where: { [step.orgField]: orgId } });
    const members: { userId: string }[] = await db.membership.findMany({ where: { orgId }, select: { userId: true } });
    let usersLeftWithoutOrg = 0;
    for (const { userId } of members) {
      if ((await db.membership.count({ where: { userId, orgId: { not: orgId } } })) === 0) usersLeftWithoutOrg += 1;
    }
    return {
      org,
      blockedReason: org.isDefault ? USER_DATA_ERROR_CODES.DEFAULT_ORG_NOT_OFFBOARDABLE : null,
      models,
      members: members.length,
      invites: db.invite ? await db.invite.count({ where: { orgId } }) : 0,
      storageObjects: orgPlan.storage ? await db[orgPlan.storage.delegate].count({ where: { [orgPlan.storage.orgField]: orgId } }) : 0,
      usersLeftWithoutOrg,
      preconditions: await this.preconditions(orgId),
    };
  }

  /**
   * Validates, enqueues `org.offboard` (or returns the one in flight) and audits it.
   *
   * @param actorUserId - the caller.
   * @param orgId - the organization.
   * @param body - the slug as confirmation, the user disposition and an optional skip reason.
   * @throws ConflictException single mode, the default organization, a failing precondition; BadRequestException a wrong slug.
   */
  async request(
    actorUserId: string,
    orgId: string,
    body: { confirmation: string; userDisposition?: OffboardingUserDisposition; skipExport?: { reason: string } },
  ): Promise<UserDataJobStarted> {
    this.assertMultiOrg();
    const org = await this.org(orgId);
    if (org.isDefault) {
      throw reason(ConflictException, USER_DATA_ERROR_CODES.DEFAULT_ORG_NOT_OFFBOARDABLE, 'The default organization can never be offboarded');
    }
    if (!z.literal(org.slug).safeParse(body.confirmation).success) {
      throw reason(BadRequestException, USER_DATA_ERROR_CODES.CONFIRMATION_MISMATCH, `Type the organization's slug, "${org.slug}", to confirm`);
    }
    const failing = (await this.preconditions(orgId)).filter((check) => !check.passed);
    if (failing.length > 0 && !body.skipExport) {
      throw reason(ConflictException, USER_DATA_ERROR_CODES.OFFBOARDING_PRECONDITION_FAILED, 'A precondition of the offboarding failed', {
        preconditions: failing,
      });
    }
    const userDisposition = body.userDisposition ?? 'keep';
    const job = await this.jobs.enqueue({
      type: ORG_OFFBOARD_JOB_TYPE,
      reason: 'rerun',
      subjectType: ORG_OFFBOARD_SUBJECT_TYPE,
      subjectId: orgId,
      payload: { orgId, actorUserId, userDisposition },
      orgId: null,
    });
    await this.audit.record({
      action: USER_DATA_AUDIT_ACTIONS.OFFBOARD_REQUESTED,
      actorUserId,
      targetType: 'organization',
      targetId: orgId,
      meta: {
        orgId,
        jobId: job.id,
        status: job.status,
        userDisposition,
        skippedPreconditions: failing.length > 0 ? failing.map((check) => check.id).join(',') : null,
        skipReason: failing.length > 0 ? (body.skipExport?.reason ?? null) : null,
      },
    });
    return { jobId: job.id, status: statusOf(job) };
  }

  /**
   * An offboarding job of this organization.
   *
   * @param orgId - the organization.
   * @param jobId - the job.
   * @throws NotFoundException for any other job.
   */
  async status(orgId: string, jobId: string): Promise<OrgOffboardingStatus> {
    this.assertMultiOrg();
    const job: Job | null = await this.db.system('admin-aggregate').job.findFirst({
      where: { id: jobId, type: ORG_OFFBOARD_JOB_TYPE, subjectType: ORG_OFFBOARD_SUBJECT_TYPE, subjectId: orgId },
    });
    if (!job) throw new NotFoundException('Offboarding job not found');
    return {
      jobId: job.id,
      status: statusOf(job),
      result: resultOf(job, orgOffboardingResultSchema),
      error: job.status === 'failed' ? (job.lastError ?? 'The offboarding failed') : null,
    };
  }
}
