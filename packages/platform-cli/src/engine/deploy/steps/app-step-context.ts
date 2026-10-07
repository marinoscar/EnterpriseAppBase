import type { runCommand as defaultRunCommand } from '../executor.js';
import { checkoutPathFor } from '../version-step.js';

import type { StepContext } from './pipeline.js';
import type { DeployPipeline, DeployStepContext } from './registry.js';

/** The part of an install or update context an app step's context is built from. */
export interface PipelineContextFacts extends StepContext {
  options: { deployRoot: string };
  runCommand: typeof defaultRunCommand;
  commitSha?: string | undefined;
}

/**
 * Builds the narrow context an app's deploy step sees from the pipeline's own
 * (#715). Commands run as a built-in step's do (the journal's redactor on
 * every message, the result in the journal), and every output line reaches
 * `DeployHooks.onLog` REDACTED too, which an app's step cannot forget.
 * Nothing here writes to a terminal.
 */
export function appStepContext(pipeline: DeployPipeline, context: PipelineContextFacts): DeployStepContext {
  const { deployRoot } = context.options;
  return {
    pipeline,
    deployRoot,
    checkoutPath: checkoutPathFor(deployRoot),
    commitSha: context.commitSha,
    hooks: context.hooks,
    log(line) {
      const redacted = context.journal.redact(line);
      context.journal.line(redacted);
      context.hooks?.onLog?.(redacted);
    },
    progress(message) {
      context.hooks?.onProgress?.(context.journal.redact(message));
    },
    async exec(argv, options) {
      const result = await context.runCommand(argv, {
        cwd: options?.cwd ?? checkoutPathFor(deployRoot),
        ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options?.allowExitCodes === undefined ? {} : { allowExitCodes: options.allowExitCodes }),
        redact: context.journal.redact,
        ...(context.hooks?.onLog === undefined
          ? {}
          : { onLine: (line: string) => context.hooks?.onLog?.(context.journal.redact(line)) }),
      });
      context.journal.command(result);
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    },
  };
}
