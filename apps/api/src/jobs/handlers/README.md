# Job Handlers

This directory contains job handler implementations for the background job
queue (epic #254). One class per job type; the queue itself never changes.

## Overview

A handler is the code that runs one kind of background job. The queue owns
everything around it — enqueueing and deduplication, claiming with a lease,
attempts and retries, terminal status, the admin dashboard — and knows nothing
about any individual type beyond the string in `Job.type`.

Typical job types a fork adds:

- Send an email or dispatch a notification off the request path
- Generate an export (CSV, PDF, ZIP) a user downloads later
- Call a slow or rate-limited third-party API
- Re-index, re-derive, or backfill a table after a change
- Periodic maintenance: prune expired rows, roll up stats, expire tokens

## Creating a Handler

### 1. Implement the `JobHandler` Interface

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job } from '@prisma/client';

import { JobHandler } from '../job-handler.interface';
import { JobHandlerRegistry } from '../job-handler.registry';

@Injectable()
export class MyCustomHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(MyCustomHandler.name);

  // Unique across the process, and PERMANENT once jobs of this type exist:
  // `jobs` rows outlive the handler that produced them.
  readonly type = 'my-feature.do-the-thing';

  constructor(private readonly registry: JobHandlerRegistry) {}

  // 2. Self-register (see below).
  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    // Do the work. THROW TO FAIL — the worker records the error message in
    // `Job.lastError` and retries. Returning normally means done and durable.
    this.logger.log(`Running ${job.id}`);
  }
}
```

Two rules for `process`:

- **Throw to fail.** There is no result object to return. A rejection becomes
  `Job.lastError` plus a retry; a normal return means the work committed. Do
  not `try/catch` and swallow — a job that silently reports success is worse
  than one that retries.
- **Be idempotent where you can.** The queue is at-least-once, never
  exactly-once: a job can run twice after a retry, or after a lease expired
  because the executing process was killed mid-run.

### 2. Self-Register in `OnModuleInit`

Registration is explicit, from the handler's own `onModuleInit()`. There is no
decorator to add and no central list of types to edit — that one
`this.registry.register(this)` line is the entire mechanism, and it is
grep-able when you later ask "why is this type running?".

A duplicate `type` **overwrites** the earlier registration and logs a warning:
the last registration wins, which is how a fork deliberately replaces a
framework handler with its own. If you did not mean to shadow anything, that
warning is telling you two handlers share a `type` string.

### 3. Add It to Your Feature Module

The handler needs to be a provider somewhere so that Nest constructs it and
calls `onModuleInit()`. Put it in the module that owns the feature, and import
`JobsModule` for the registry:

```typescript
import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { MyCustomHandler } from './handlers/my-custom.handler';

@Module({
  imports: [JobsModule],
  providers: [MyCustomHandler],
})
export class MyFeatureModule {}
```

That is the whole wiring change. Nothing in the worker, the claim query, the
enqueue service or the dashboard is touched.

### 4. Enqueue Work

Inject `JobsService` (exported by `JobsModule`, which step 3 already imported)
and enqueue from wherever the trigger lives:

```typescript
await this.jobs.enqueue({
  type: 'my-feature.do-the-thing',
  reason: 'upload',
  subjectType: 'storage_object',
  subjectId: object.id,
  payload: { objectId: object.id },
});
```

`payload` is handler-defined and opaque to the queue (a JSONB column). Keep it
small and keep it to **identifiers**, not copies of data — the job may run
minutes later, and a row it names should be re-read at run time rather than
carried inside the payload where it can go stale.

**Enqueueing the same work twice is safe by default.** A job is deduplicated
on `type` plus subject for as long as an earlier one is still `pending` or
`running`: the second call does not create a second row, it returns the job
already in flight. Both callers get a job, neither gets an error, and the
returned row is the *first* caller's — so its `reason`, `priority` and
`payload` are the ones that job was created with. When several jobs of the
same type against the same subject are legitimately distinct work, opt out
per call:

```typescript
await this.jobs.enqueue({ ...input, skipDedup: true });
```

Two more optional fields worth knowing about:

- `priority` — **ascending is more urgent**, `0` is normal, negative is
  ahead of it.
- `scheduledFor` — the earliest time the job may be claimed. Omit it (the
  default) for "run as soon as a worker is free".

The full reasoning — why the database decides dedup instead of a
`findFirst` pre-check, and why `skipDedup` costs nothing — is
[`docs/specs/job-queue.md`](../../../../../docs/specs/job-queue.md) §4.

### The Type Appears in the Dashboard Automatically

No migration, no enum, no queue wiring. `Job.type` is a plain string column
precisely so a new handler costs zero schema change, and the admin dashboard
lists whatever `JobHandlerRegistry.types()` reports. Add a friendly label for
your type in `../job-type-labels.ts` if you want one — an unmapped type
renders as its raw type string rather than blank, so the label is optional
polish and never a requirement.

## Node Eligibility (Optional)

Some job types can have their expensive part computed on a **remote worker
node** instead of on the API server: the node computes, posts a result back,
and the server writes it down. The node has no database access at all.

**A type is node-eligible if, and only if, its handler carries BOTH optional
members:**

```typescript
readonly nodeResultSchema = z.object({ pages: z.number().int().positive() });

async persistNodeResult(job: Job, result: unknown): Promise<void> {
  const parsed = this.nodeResultSchema.parse(result);
  // PERSIST ONLY — write the value down and nothing else.
}
```

- **Both members** → node-eligible.
- **Neither member** → server-only. This is the default, and where every
  handler starts.
- **Exactly one member** → server-only. A schema with no persist function
  describes a payload nobody can store; a persist function with no schema
  would have to trust an unvalidated body from a remote machine. Both collapse
  to the safe answer rather than being treated as a half-eligible case.

There is no `nodeEligible: boolean` flag anywhere, on purpose: a flag can
disagree with the members it describes, and deriving the answer from them
makes that wrong state unrepresentable. `JobHandlerRegistry.serverOnlyTypes()`
is that derivation, and it is what the later `system` worker mode reads.

`persistNodeResult` must do **only the persist half** — no recomputation, no
re-downloading the input, no second call to the provider the node used. That
rule is what keeps a node from needing database access; break it and the
server is doing the work twice and the node's answer is decorative. If a
result cannot be persisted without redoing the work, the type is not
node-eligible: drop both members.

## Example Handler

See `example-echo.handler.ts` — a server-only handler that logs its payload
and returns. It is deliberately trivial and side-effect free, and it is a live
implementation of the contract rather than a comment about one.

## Related Files

| File | What it is |
|---|---|
| `../job-handler.interface.ts` | The contract, and the node-eligibility rules |
| `../job-handler.registry.ts` | The registry, and why registration is explicit |
| `../job-keys.ts` | `buildDedupKey()` — the single definition of `Job.dedupKey` |
| `../job-type-labels.ts` | Display labels for the admin UI |
| `../jobs.module.ts` | Where the registry and the example handler are provided |
| `docs/specs/job-queue.md` | The design spec: decisions, rejected alternatives |
