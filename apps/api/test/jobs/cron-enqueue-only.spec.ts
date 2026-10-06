// =============================================================================
// ⚠ NO `@Cron` BODY DOES LONG-RUNNING WORK INLINE (issue #353, epic #345)
// =============================================================================
//
// Epic #345 decision 1 says every long-running activity is a queue job. #351
// and #352 moved the database backup, and #353 moved everything else: the
// restore, three cleanup crons that had been deleting rows inline since the
// first week of this repository, two fleet sweeps, and the backup subsystem's
// own housekeeping. This test is what stops that from quietly reverting.
//
// -----------------------------------------------------------------------------
// WHY A STRUCTURAL TEST RATHER THAN A REVIEW CONVENTION
// -----------------------------------------------------------------------------
//
// The regression is invisible from inside the file that causes it. Somebody
// adding a `@Cron` in 2027 writes six lines that delete some rows, and every
// existing test still passes: the deletion works, nothing crashes, and the only
// symptom is that the work is missing from the admin job list, holds no worker
// slot, has no timeout, gets no retry, and answers "did it run last night?"
// with a log grep. That is precisely the class of defect a review catches only
// if the reviewer happens to remember the rule.
//
// So the rule is executable, and the EXEMPTIONS ARE A LIST rather than a
// judgement call: adding a third one means editing this array in a pull request
// that argues for it, which is exactly the conversation that should happen.
//
// -----------------------------------------------------------------------------
// ⚠ WHAT "LONG-RUNNING" MEANS HERE, SO THIS DOES NOT READ AS A LOOPHOLE
// -----------------------------------------------------------------------------
//
// It means WORK WITH A DURATION WORTH ACCOUNTING FOR — a sweep over a table, a
// dump, a network round trip per row, anything that can take minutes or fail in
// a way somebody needs to see. It does NOT mean "every asynchronous call".
// Fire-and-forget notification dispatch (`void this.notifications
// .notifyPermissionHolders(...)`, and the delivery channels behind it) is
// deliberately NOT covered by the rule and is deliberately not on the exemption
// list: a queue row per email buys nothing, and the dispatcher already contracts
// never to reject. See docs/specs/job-queue.md § "All long-running work is a
// job".
//
// -----------------------------------------------------------------------------
// WHAT IT CHECKS, AND WHAT IT HONESTLY CANNOT
// -----------------------------------------------------------------------------
//
// It reads the BODY of every `@Cron`-decorated method under `apps/api/src` and
// requires two things of it: that it queues something, and that it contains
// none of the markers of doing work itself. It does not follow calls into
// helper methods — a cron calling `this.fireDueBackup(...)` is trusted, and
// `fireDueBackup`'s own spec is what pins that it only enqueues. That limit is
// stated rather than hidden: this test is a tripwire on the shape of a cron
// body, not a proof about the whole call graph.
//
// THE SCAN LIVES IN `@marinoscar/platform-api/testing` (issue #694), so every
// app that consumes the platform runs the very same rule through
// `runPlatformConformance()`. What stays HERE is this application's DATA: the
// exemption list below and the vacuity minimum. Same markers, same enqueue
// pattern, same three exemptions as before the move.
// =============================================================================

import { join } from 'node:path';

import { runPlatformConformance } from '@marinoscar/platform-api/testing';

/** The API's source root, from this file. */
const SRC = join(__dirname, '..', '..', 'src');

/**
 * ⚠ THE EXEMPTION LIST. THREE ENTRIES, AND EACH ONE IS ARGUED.
 *
 * A fourth may be legitimate one day. Adding it means changing this array in a
 * pull request whose description says why the work must NOT be a job — which is
 * the whole reason the list is here rather than in a comment somewhere.
 */
const EXEMPT: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'jobs/tasks/job-stuck-reset.task.ts',
    why:
      'The lease reaper is WHAT RECOVERS ABANDONED JOBS. Recovery that depends on ' +
      'the thing it recovers is not recovery: a queue wedged badly enough to strand ' +
      'a reaper job is exactly the queue that needs reaping.',
  },
  {
    file: 'jobs/tasks/temp-file-janitor.task.ts',
    why:
      'It cleans up after a SIGKILLed worker and sweeps THIS PROCESS\'S LOCAL DISK. ' +
      'A node — or another replica — claiming that job would sweep the wrong ' +
      'filesystem and leave the full one untouched.',
  },
  {
    file: 'nodes/tasks/node-secret-sweep.task.ts',
    why:
      'It destroys the short-lived PostgreSQL roles brokered to worker nodes (#349), ' +
      'and its own header lists three cases the event path structurally cannot cover ' +
      '— the first of which is "a job settled by the reaper". Making credential ' +
      'revocation depend on the queue means a wedged queue leaks live database ' +
      'credentials for as long as it stays wedged. Same argument as the reaper, ' +
      'applied to a security control rather than to recovery.',
  },
];

runPlatformConformance({
  sourceRoots: [SRC],
  suites: { cronEnqueueOnly: { exempt: EXEMPT, minCronFiles: 8 } },
});
