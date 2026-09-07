// =============================================================================
// The offline-node prune (issue #270, epic #254)
// =============================================================================
//
// Fleet inventory is not history. A `Job` row is a record of work that
// happened and is kept until the history purge decides otherwise; a
// `WorkerNode` row is a LIVE REGISTRATION — the machine it names is either
// still out there or it is not. A laptop that ran three jobs in April and was
// reimaged in May leaves a row that will never heartbeat again, and a fleet
// page that shows fifty of those is a fleet page nobody can read.
//
// So `nodes.offlineRetentionDays` forgets them. This task is what makes that
// setting mean something.
//
// -----------------------------------------------------------------------------
// ⚠ THIS TASK IS DEAD CODE WITHOUT `NodeStaleOfflineTask`, AND THAT ORDERING
// IS THE POINT OF THE PAIR
// -----------------------------------------------------------------------------
//
// It selects `status = 'offline'`. A crashed node never calls `deregister`, so
// nothing ever writes that status to its row — it sits at `online` forever,
// and this prune can NEVER reach it. Retention would then apply to exactly the
// nodes that do not need it (the gracefully shut down ones) and never to the
// ones that do (the crashed ones that actually accumulate).
//
// That is the failure this pair is designed around, and it is invisible from
// inside this file: the prune runs daily, logs "0 nodes pruned", and looks
// like a fleet with nothing to clean up. The stale sweep is what supplies this
// task's input, and `test/nodes/node-fleet-lifecycle.db.spec.ts` asserts the
// two IN SEQUENCE — crash a node, sweep, prune, expect the row gone — rather
// than asserting each in isolation, because each in isolation passes with the
// bug present.
//
// REJECTED: pruning by age alone, ignoring `status` ("delete any node whose
// last heartbeat is older than retention"). It would make this task work
// without the sweep, and it would delete a DISABLED node — an administrator's
// explicit intent, recorded nowhere else — and a `draining` node that is
// slowly finishing a long job. `status = 'offline'` is what keeps deletion to
// rows that something has already concluded are gone.
//
// -----------------------------------------------------------------------------
// A NODE STILL HOLDING A `running` JOB IS NEVER DELETED
// -----------------------------------------------------------------------------
//
// `Job.claimedByNode` is `onDelete: SetNull`, so deleting a node cannot delete
// a job and cannot fail on a foreign key — the deletion is SAFE regardless.
// The exclusion is not about safety, it is about not lying: a `running` row
// whose `claimedByNodeId` was just nulled says "some executor is working on
// this, and we no longer know which one", which is strictly less information
// than "node X is working on this" and is the state the lease reaper's
// diagnostics read. Live queue state must never point at a row that just
// vanished underneath it.
//
// In practice this is a narrow window — a node has to be `offline`, past
// retention (30 days by default), AND holding a job whose lease has not been
// reaped — but it is exactly the window a partitioned node produces, and the
// cost of the exclusion is one indexed query. Such a node is skipped, not
// failed: the reaper settles or requeues the job on its own schedule, and the
// next daily tick deletes the node. Nothing has to be re-run by hand.
//
// REJECTED: deleting the node and letting `SetNull` do its thing, on the
// grounds that the reaper will requeue the orphaned job anyway. It does — but
// between the delete and the next reaper tick the job is a `running` row owned
// by nobody, which is indistinguishable from the corrupt state the reaper's
// "zombie" signal exists to clean up after. Do not manufacture the state a
// recovery path exists to recover from.
//
// REJECTED (the other direction): refusing to delete a node holding a job in
// ANY state. Every node that ever ran anything holds `succeeded` and `failed`
// rows forever, so the prune would never delete anything at all. Only
// `running` is live.
//
// -----------------------------------------------------------------------------
// DAILY, AND WHY THIS ONE IS NOT A SINGLE STATEMENT
// -----------------------------------------------------------------------------
//
// Retention is measured in DAYS (30 by default), so a daily tick adds at most
// a day to a thirty-day promise. Ten minutes would ask the same question 144
// times to get the same answer.
//
// Unlike the sweep this is three statements — select candidates, ask which are
// busy, delete the rest — because the exclusion is a fact about a different
// table. It is still idempotent and still needs no overlap guard: the final
// `deleteMany` RE-ASSERTS the full candidate predicate (`status`, and the age),
// so a node that re-registered between the read and the delete is left alone,
// and two replicas racing produce one delete and one no-op.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { NodeLifecycleService } from '../node-lifecycle.service';
import { PrismaService } from '../../prisma/prisma.service';

/** What one prune did, split by what stopped a candidate from being deleted. */
export interface PruneOfflineNodesResult {
  /** Node rows removed. */
  deleted: number;

  /** Candidates left in place because they still hold a `running` job. */
  skippedBusy: number;
}

/**
 * The `where` identifying an `offline` node whose record has outlived
 * retention, as a pure function of the cutoff.
 *
 * The `OR` mirrors the stale sweep's arm for arm, and it has to: a node that
 * never heartbeated is aged by `registeredAt` there, so ageing it by
 * `lastHeartbeatAt` here would sweep it to `offline` and then never delete it
 * (`NULL < cutoff` is NULL, never true). The two predicates are two halves of
 * one lifecycle, and a change to one is a change to both.
 *
 * Exported so the delete can re-assert exactly what the select matched,
 * without a second hand-written copy that can drift from it.
 */
export function prunableOfflineNodeWhere(cutoff: Date): Prisma.WorkerNodeWhereInput {
  return {
    status: 'offline',
    OR: [
      { lastHeartbeatAt: { lt: cutoff } },
      { lastHeartbeatAt: null, registeredAt: { lt: cutoff } },
    ],
  };
}

@Injectable()
export class NodeOfflinePruneTask {
  private readonly logger = new Logger(NodeOfflinePruneTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: NodeLifecycleService,
    private readonly config: ConfigService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    if (!this.enabled()) {
      this.logger.debug(
        'The offline-node prune is disabled (NODE_OFFLINE_PRUNE_ENABLED); skipping'
      );

      return;
    }

    try {
      const { deleted, skippedBusy } = await this.prune();

      if (deleted > 0 || skippedBusy > 0) {
        this.logger.log(
          `Fleet prune: ${deleted} offline worker node(s) forgotten, ` +
            `${skippedBusy} kept because they still hold a running job`
        );
      } else {
        this.logger.debug('Fleet prune: no offline node is past its retention');
      }
    } catch (error) {
      // SWALLOWED — see `NodeStaleOfflineTask` for the argument.
      this.logger.error(
        `Fleet prune failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Deletes every `offline` node past retention that is not still holding a
   * `running` job.
   *
   * Exposed as its own method so a test can drive it without going through the
   * kill switch and the swallowing `catch`.
   */
  async prune(): Promise<PruneOfflineNodesResult> {
    const policy = await this.lifecycle.getPolicy();

    // ONE `now` for the whole prune, so the select and the delete's
    // re-assertion cannot disagree about the cutoff.
    const now = new Date();
    const cutoff = this.lifecycle.retentionCutoff(policy, now);
    const where = prunableOfflineNodeWhere(cutoff);

    const candidates = await this.prisma.workerNode.findMany({
      where,
      // Ids only. The row is about to be deleted; nothing here needs its
      // capabilities blob.
      select: { id: true },
    });

    if (candidates.length === 0) {
      return { deleted: 0, skippedBusy: 0 };
    }

    const candidateIds = candidates.map((node) => node.id);

    // ONE query for the whole candidate set, not one per node: `distinct`
    // makes this "which of these nodes is busy", which is the question, rather
    // than "list every running job", which could be large.
    const busy = await this.prisma.job.findMany({
      where: { status: 'running', claimedByNodeId: { in: candidateIds } },
      select: { claimedByNodeId: true },
      distinct: ['claimedByNodeId'],
    });

    const busyIds = new Set(busy.map((job) => job.claimedByNodeId).filter(isNonNull));
    const deletable = candidateIds.filter((id) => !busyIds.has(id));

    if (deletable.length === 0) {
      return { deleted: 0, skippedBusy: busyIds.size };
    }

    // The candidate predicate is RE-ASSERTED alongside the ids rather than
    // deleting by id alone: between the select above and this write a node may
    // have re-registered (which clears `offline` and stamps a fresh
    // heartbeat), and deleting it then would destroy a live registration a
    // worker is actively using. Re-asserting makes that case a no-op instead.
    const { count } = await this.prisma.workerNode.deleteMany({
      where: { ...where, id: { in: deletable } },
    });

    return { deleted: count, skippedBusy: busyIds.size };
  }

  /**
   * Whether this process prunes at all.
   *
   * DEFAULTS TO ON, and only the literal `false` turns it off — the same
   * fail-open direction as every other sweep switch in this repository. Note
   * that failing open here means "forget offline nodes after the configured
   * retention", which is the documented default behaviour, not a surprise: the
   * shipped `offlineRetentionDays` is 30, and the rows it removes are
   * registrations for machines that have not been heard from in a month.
   */
  private enabled(): boolean {
    return this.config.get<boolean>('nodes.offlinePruneEnabled') !== false;
  }
}

/** A type guard, so `claimedByNodeId`'s `string | null` narrows to `string`. */
function isNonNull(value: string | null): value is string {
  return value !== null;
}
