import type { JobExecutionContext, JobExecutor } from '@marinoscar/platform-cli/node';

// =============================================================================
// EXAMPLE, NOT WIRED: an app node executor added through registerNodeExecutor
// (#715)
// =============================================================================
//
// The node-side half of an app job type. The server-side half (a JobHandler
// with `nodeResultSchema` + `persistNodeResult`, apps/api/src/jobs/handlers/)
// is a separate registration in the API; neither knows about the other. A
// node advertises and claims `app.echo` once this executor is registered.
//
// CLAUDE.md queue rule 3 applies to an app executor exactly as to
// `db.backup.run`: a job-scoped credential comes from `context.api.jobSecret`,
// lives in a local for the job, and is never written or logged. This one
// needs none; `echo.executor.test.ts` still runs the platform's
// `checkExecutorCredentialHygiene` over it, as every app executor should.
//
// Not in `app.ts`, so the worker claims exactly the platform's types. To use
// the pattern in a fork, add it to `APP_CLI_OPTIONS.nodeExecutors`:
//
//   nodeExecutors: [new EchoExecutor()],
// =============================================================================

/** What `app.echo` returns: the params it was given, and when. */
export interface EchoResult {
  echoed: Record<string, unknown>;
  at: string;
  computedBy: 'node';
}

/** Returns its params. The smallest executor there is. */
export class EchoExecutor implements JobExecutor {
  readonly type = 'app.echo';
  readonly requiresInput = false;

  async execute(context: JobExecutionContext): Promise<EchoResult> {
    context.log('echo', { jobId: context.job.id });
    return { echoed: context.params, at: new Date().toISOString(), computedBy: 'node' };
  }
}
