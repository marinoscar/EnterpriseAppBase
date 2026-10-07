// =============================================================================
// Resolving the organization a piece of tenant work runs in (issue #725)
// =============================================================================
//
// Row-level security shows tenant code one organization's rows, so every
// request and every job must name its organization:
//
//   - an HTTP request: `principal.activeOrgId` (the `@CurrentOrg()` decorator);
//   - a job: the `orgId` its enqueuer put in the payload.
//
// A job enqueued BEFORE #725 has no `orgId`. The rule for those, from the
// story: in `single` tenancy mode the work belongs to the default
// organization (that is the only organization there is); in `multi` mode the
// job FAILS with a clear error rather than guess, because guessing an
// organization is exactly the cross-tenant leak this story exists to stop.
//
// Dependency-free on purpose (a plain function over `PrismaService`, like
// `currentTenancyMode`): handlers and services that already hold the prisma
// client need no extra provider, and a unit test needs no extra stub.
// =============================================================================

import { currentTenancyMode } from '../auth/tenancy-mode';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The work has no organization and the deployment is multi-tenant. A
 * programming or data error, never a client error: it is thrown by job
 * handlers (the job fails with this message in `lastError`) and by services
 * called without an active organization.
 */
export class MissingOrgScopeError extends Error {
  constructor(context: string) {
    super(
      `${context} carries no organization (orgId) and this deployment is multi-tenant (TENANCY_MODE=multi), ` +
        'so there is no safe default to run it in. Re-enqueue the work with an orgId in its payload.',
    );
    this.name = 'MissingOrgScopeError';
  }
}

/** The `orgId` a job payload carries, or `undefined` when it has none (a pre-#725 job). */
export function orgIdFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as { orgId?: unknown }).orgId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The organization to run in: `orgId` when given; otherwise, in `single` mode,
 * the default organization; in `multi` mode {@link MissingOrgScopeError}.
 *
 * @param prisma - only `organization` is read (no row-level security on it).
 * @param orgId - the organization the caller already knows, if any.
 * @param context - names the work for the error message ("Job 123 (ai.response.run)").
 * @throws MissingOrgScopeError in multi mode, or when single mode has no default organization.
 */
export async function resolveOrgId(
  prisma: Pick<PrismaService, 'organization'>,
  orgId: string | null | undefined,
  context: string,
): Promise<string> {
  if (typeof orgId === 'string' && orgId.length > 0) return orgId;

  if (currentTenancyMode() !== 'single') throw new MissingOrgScopeError(context);

  const org = await prisma.organization.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!org) throw new MissingOrgScopeError(`${context} (the default organization does not exist)`);
  return org.id;
}

/** {@link resolveOrgId} for a job: the payload's `orgId`, else the single-mode default. */
export function resolveJobOrgId(
  prisma: Pick<PrismaService, 'organization'>,
  job: { id: string; type: string; payload: unknown },
): Promise<string> {
  return resolveOrgId(prisma, orgIdFromPayload(job.payload), `Job ${job.id} (${job.type})`);
}
