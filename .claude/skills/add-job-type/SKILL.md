---
name: add-job-type
description: Add a background job type to the queue - implement a JobHandler, self-register it, enqueue it through JobsService, declare its execution profile, decide node eligibility, scope it to an organization, and add the tests that pin it. Use when a feature must do long-running work (a dump, a sweep, an export, a network round trip per row), when adding an ai.* job, or when a @Cron or @OnEvent body would otherwise work inline.
---

# Add a job type

Recipe with full code: `packages/platform-api/src/jobs/handlers/README.md` (`grep -n '^##' <file>` first; read only the section you need). Worked examples: `apps/api/src/examples/jobs/` (`example-echo.handler.ts` server-only, `example-checksum.handler.ts` node-eligible). Spec: `docs/specs/job-queue.md`.

## Steps

1. Create the handler beside the feature: a class implementing `JobHandler` (`packages/platform-api/src/jobs/job-handler.interface.ts`) with `type` (a unique string), optional `label`, and `process(job)`.
2. Self-register in `onModuleInit`: `this.registry.register(this)`. Add the class to the feature module's `providers`.
3. Enqueue through `JobsService` (`packages/platform-api/src/jobs/jobs.service.ts`). A `@Cron` only decides whether work is due and enqueues (`enqueueHousekeepingJob` in `jobs/housekeeping.enqueue.ts`; reference `jobs/tasks/job-history-purge.task.ts`). An `@OnEvent` body never does I/O; it enqueues.
4. Add the type to `apps/api/test/jobs/job-type-snapshot.spec.ts` (it pins every registered type) and write a handler spec.

## Rules

- A job `type` string is permanent once jobs of that type exist. Rename = new type.
- Any work that outlives the request or tick is a job. No detached `void this.doIt()`. Conformance suites `cron-enqueue-only` and `on-event-no-io` (`apps/api/test/conformance.spec.ts`) fail otherwise. The only exemptions are the three in `CLAUDE.md`; never add a fourth.
- Node eligibility is the default: provide `nodeResultSchema` plus `persistNodeResult` unless the handler writes as it goes, reads several tables mid-computation, or needs a privilege a node must never hold. Eligibility is derived; there is no `nodeEligible` flag. Publish the result contract under `apps/api/src/jobs/contracts/`.
- A per-job secret is declared with `nodeSecretBroker` (`jobs/job-secret-broker.ts`); a node never persists it; `job_node_secrets` stores handles only.
- `profile` is optional and exactly `{ maxRuntimeMs, maxAttempts }`. Never add `leaseMs` or `heartbeatMs`.
- Pass `orgId` on `EnqueueJobInput` (`null` for a system job). An org-scoped job with no natural subject uses `subjectType: 'organization', subjectId: orgId`. A handler touching org tables runs under `JobScope.run(job, fn)` (`jobs/job-scope.ts`); the payload carries `orgId`.
- `ai.*` job types are server-only: implement neither `nodeResultSchema` nor `persistNodeResult` (suite `ai-jobs-server-only`), and call AI only through `AiService.forUser(userId, { orgId, feature })`.
- Notify after the job's write commits, outside any `$transaction`.
- No migration is needed: `jobs.type` is a plain string. The queue has no row-level security.

## Verify

```bash
cd apps/api && npm run typecheck && npm test
npm run test:db --workspace=api    # if you touched queue SQL or org tables
```

Flag the new type for the docs agent (job-type inventory in `docs/ARCHITECTURE.md`).
