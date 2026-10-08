// =============================================================================
// THE REFERENCE APP'S CONFORMANCE ENTRY (issue #742)
// =============================================================================
//
// Every invariant the platform enforces through a booted app or a source scan
// runs HERE, through `runPlatformConformance()`, so the suite ids and their
// cases are the same in every app that consumes the packages. This file holds
// only the reference app's DATA (source roots, argued exemptions, minimums);
// the scans, the markers and the known-bad proofs live in
// `@marinoscar/platform-api` (`packages/platform-api/src/testing/README.md`
// lists every suite id, who moved it and what it enforces).
//
// Slice-local suites (identity, settings, storage, ...) keep their own entry
// next to the slice's other app tests (`apps/api/test/<slice>/*-conformance.spec.ts`).
//
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
// It reads the BODY of every `@Cron`-decorated method under `apps/api/src`
// and under every packaged slice the app runs whose source lives in this
// repository (`CRON_SOURCE_ROOTS` in ./cron-source-roots.ts: the telemetry
// slice, #703, the sharing slice, #729, and the jobs and nodes slices, #734,
// all under `packages/platform-api/src/`), and
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

import { aiPackageProviderDirs } from '@marinoscar/platform-api/ai/testing';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing a slice's testing entry REGISTERS its suites with the harness.
import '@marinoscar/platform-api/ai/testing';
import '@marinoscar/platform-api/jobs/testing';

import { aiConformanceFixture } from './conformance/ai-fixture';
import { API_SOURCE_ROOT, CRON_SOURCE_ROOTS, JOBS_SLICE_SOURCE_ROOT, NODES_SLICE_SOURCE_ROOT } from './jobs/cron-source-roots';

const REPO = join(__dirname, '..', '..', '..');
const PACKAGE_API_SRC = join(REPO, 'packages', 'platform-api', 'src');

/**
 * ⚠ THE EXEMPTION LIST. THREE ENTRIES, AND EACH ONE IS ARGUED.
 *
 * A fourth may be legitimate one day. Adding it means changing this array in a
 * pull request whose description says why the work must NOT be a job — which is
 * the whole reason the list is here rather than in a comment somewhere.
 *
 * All three live in the packaged slices since #734:
 * `packages/platform-api/src/jobs/tasks/job-stuck-reset.task.ts`,
 * `packages/platform-api/src/jobs/tasks/temp-file-janitor.task.ts` and
 * `packages/platform-api/src/nodes/tasks/node-secret-sweep.task.ts`. Each entry
 * is PINNED to its slice's root (`root`), so the same relative path under the
 * app's own source, or another slice's, is never exempt by accident.
 */
const EXEMPT: ReadonlyArray<{ file: string; root: string; why: string }> = [
  {
    file: 'tasks/job-stuck-reset.task.ts',
    root: JOBS_SLICE_SOURCE_ROOT,
    why:
      'The lease reaper is WHAT RECOVERS ABANDONED JOBS. Recovery that depends on ' +
      'the thing it recovers is not recovery: a queue wedged badly enough to strand ' +
      'a reaper job is exactly the queue that needs reaping.',
  },
  {
    file: 'tasks/temp-file-janitor.task.ts',
    root: JOBS_SLICE_SOURCE_ROOT,
    why:
      'It cleans up after a SIGKILLed worker and sweeps THIS PROCESS\'S LOCAL DISK. ' +
      'A node — or another replica — claiming that job would sweep the wrong ' +
      'filesystem and leave the full one untouched.',
  },
  {
    file: 'tasks/node-secret-sweep.task.ts',
    root: NODES_SLICE_SOURCE_ROOT,
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
  sourceRoots: CRON_SOURCE_ROOTS,
  suites: {
    // The `@Cron` half of queue rule 1. Suite id: `cron-enqueue-only`.
    cronEnqueueOnly: { exempt: EXEMPT, minCronFiles: 14 },
    // The `@OnEvent` half. Suite id: `on-event-no-io`. The listener files that
    // must be seen are the packaged slices' (their roots are relative).
    onEventNoIo: {
      minListenerFiles: 5,
      mustScan: [
        'ops/node-secret-revoker.ts',
        // The listener for the nodes slice's `nodes.node.offline` event, in the
        // notifications slice since #738: notification dispatch, the
        // documented exception, and no storage I/O.
        'ops/node-offline-notifier.ts',
        'ops/job-failure-notifier.ts',
        'broadcasts/broadcast-failure.listener.ts',
      ],
    },

    // ---- the AI platform's invariants (CLAUDE.md AI rules 1 to 4) ------------
    // The five that boot the app take the fixture (./conformance/ai-fixture.ts):
    // routes, job types and roles are DISCOVERED from the booted app.
    aiKillSwitch: { fixture: aiConformanceFixture },
    aiRbacMatrix: { fixture: aiConformanceFixture },
    aiSecretEgress: { fixture: aiConformanceFixture },
    aiKeyPolicy: { fixture: aiConformanceFixture },
    aiJobsServerOnly: { fixture: aiConformanceFixture },
    // AI rule 1: a provider SDK is imported only inside its adapter's directory
    // (the package's own, listed by `aiPackageProviderDirs`); the app, the web
    // and the contract import none, and no manifest but the package's declares one.
    aiNoSdkLeak: {
      apiTrees: [
        {
          name: '@marinoscar/platform-api',
          root: PACKAGE_API_SRC,
          sdkDirs: aiPackageProviderDirs(PACKAGE_API_SRC),
          minFiles: 100,
        },
        { name: 'apps/api/src', root: API_SOURCE_ROOT, minFiles: 100 },
      ],
      webTrees: [
        { name: 'apps/web/src', root: join(REPO, 'apps', 'web', 'src'), minFiles: 50 },
        { name: '@marinoscar/platform-web', root: join(REPO, 'packages', 'platform-web', 'src'), minFiles: 50 },
        { name: '@marinoscar/platform-contract', root: join(REPO, 'packages', 'platform-contract', 'src'), minFiles: 20 },
      ],
      sdkOwner: {
        manifest: join(REPO, 'packages', 'platform-api', 'package.json'),
        declares: ['openai', '@anthropic-ai/sdk', '@google/genai'],
      },
      noSdkManifests: [
        join(REPO, 'package.json'),
        join(REPO, 'apps', 'api', 'package.json'),
        join(REPO, 'apps', 'web', 'package.json'),
        join(REPO, 'apps', 'cli', 'package.json'),
        join(REPO, 'packages', 'platform-web', 'package.json'),
        join(REPO, 'packages', 'platform-contract', 'package.json'),
        join(REPO, 'packages', 'platform-cli', 'package.json'),
        join(REPO, 'packages', 'platform-db', 'package.json'),
        join(REPO, 'packages', 'platform-infra', 'package.json'),
      ],
    },
    // AI rule 6 (the base allows no orchestration library anywhere; an app that
    // adopts one passes its allowed roots).
    aiOrchestrationBoundary: {
      apiSourceRoots: [API_SOURCE_ROOT, PACKAGE_API_SRC],
      webSourceRoots: [join(REPO, 'apps', 'web', 'src'), join(REPO, 'packages', 'platform-web', 'src')],
      packageJsonPaths: [
        join(REPO, 'package.json'),
        join(REPO, 'apps', 'api', 'package.json'),
        join(REPO, 'apps', 'web', 'package.json'),
        join(REPO, 'packages', 'platform-api', 'package.json'),
        join(REPO, 'packages', 'platform-web', 'package.json'),
        join(REPO, 'packages', 'platform-contract', 'package.json'),
      ],
      allowedRoots: {},
      minApiFiles: 200,
    },
  },
});
