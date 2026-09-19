/**
 * `deploy-info/info.json` — the note this CLI leaves for the running application.
 *
 * =============================================================================
 * ⚠ THE OTHER HALF OF THE ABOUT PAGE, AND IT WAS MISSING
 * =============================================================================
 *
 * `apps/api/src/about/deploy-info.ts` reads this document, `vps.compose.yml`
 * bind-mounts the directory read-only into the api container, and the Console's
 * About page renders it. All three shipped. Nothing wrote the file — install
 * created the DIRECTORY (so the bind mount would not be created root-owned by
 * Docker) and stopped there. So the About page reported `absent` on every
 * deployment, including ones this CLI had just deployed, and said so in copy
 * carefully written not to assert a negative — which was the only reason it did
 * not read as a lie.
 *
 * =============================================================================
 * ⚠ WRITTEN AT THE HEALTH GATE, NOT AT THE END
 * =============================================================================
 *
 * If the API is answering, the application demonstrably IS deployed, and this
 * document should describe it. Writing it at the end of the pipeline means a
 * failure in `publish` — between health and the end — leaves the About page
 * reporting nothing at all about a deployment that is up and serving, which is
 * exactly when somebody is looking at it.
 *
 * That is why `run` exists in the document: a run that got far enough to write
 * this file did deploy something, and the page's third state — complete, but
 * the run did not finish — is rendered from `run.outcome` plus `run.failedStep`.
 *
 * =============================================================================
 * ⚠ THREE RULES THE READER DEPENDS ON
 * =============================================================================
 *
 * 1. `schema` IS 1 AND DOES NOT MOVE. The reader validates it strictly and
 *    everything else leniently, precisely so new fields need no bump. A bump to
 *    add an optional field makes every already-deployed API answer `invalid`
 *    the instant a newer CLI writes its file — before the container it
 *    describes has necessarily restarted.
 * 2. `null` IS THE IDIOM FOR KNOWN-TO-BE-ABSENT. Never omit a key to mean "I do
 *    not know"; the reader turns a missing value into `null` anyway, and an
 *    explicit one says a human decided rather than that a writer forgot.
 * 3. THE WRITE IS ATOMIC, and the DIRECTORY is what is mounted, not the file.
 *    A rename over an existing path gives the container the new document with
 *    no restart; bind-mounting the file itself would pin an inode and leave the
 *    container reading the old one for ever.
 */
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The one value `schema` may hold. See rule 1 above. */
export const DEPLOY_INFO_SCHEMA_VERSION = 1;

export const DEPLOY_INFO_DIRNAME = 'deploy-info';
export const DEPLOY_INFO_FILENAME = 'info.json';

export interface DeployInfoInput {
  name: string;
  version?: string | undefined;
  commitSha?: string | undefined;
  ref?: string | undefined;
  installedAt?: string | undefined;
  updatedAt?: string | undefined;
  cliVersion?: string | undefined;
  domain?: string | undefined;
  /** Step ids that completed, in order. */
  completed?: readonly string[] | undefined;
  failedStep?: string | undefined;
  outcome?: 'success' | 'failure' | undefined;
}

/** `undefined` becomes `null`; see rule 2. */
function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

export function buildDeployInfo(input: DeployInfoInput): Record<string, unknown> {
  return {
    schema: DEPLOY_INFO_SCHEMA_VERSION,
    app: {
      name: input.name,
      version: orNull(input.version),
      commitSha: orNull(input.commitSha),
      ref: orNull(input.ref),
    },
    installedAt: orNull(input.installedAt),
    updatedAt: orNull(input.updatedAt),
    deployedBy: {
      cli: 'appctl',
      version: orNull(input.cliVersion),
    },
    domain: orNull(input.domain),
    // ⚠ `null`, NOT a fabricated zero. This CLI does not ask the remote how far
    // ahead it is at deploy time, and "0 commits behind" is a claim, not an
    // absence. The reader renders null as "not known", which is true.
    remote: null,
    run: {
      completed: [...(input.completed ?? [])],
      failedStep: orNull(input.failedStep),
      // A document written at the health gate describes a deployment that is
      // answering. `success` here means the steps up to this point succeeded;
      // a later failure rewrites it with the failed step named.
      outcome: orNull(input.outcome) ?? 'success',
    },
  };
}

export function deployInfoPath(deployRoot: string): string {
  return join(deployRoot, DEPLOY_INFO_DIRNAME, DEPLOY_INFO_FILENAME);
}

/**
 * Writes the document atomically into the bind-mounted directory.
 *
 * ⚠ NEVER THROWS. This is BOOKKEEPING ABOUT a deployment, not the deployment:
 * it runs after the API is answering, so a failure here must not fail a run
 * that has already succeeded. The caller journals what came back.
 */
export function writeDeployInfo(
  deployRoot: string,
  input: DeployInfoInput,
): { written: boolean; path: string; error?: string | undefined } {
  const path = deployInfoPath(deployRoot);
  const temporary = `${path}.tmp`;

  try {
    writeFileSync(temporary, `${JSON.stringify(buildDeployInfo(input), null, 2)}\n`);
    renameSync(temporary, path);
    return { written: true, path };
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // It may never have been created. Nothing to report.
    }
    return { written: false, path, error: (error as Error).message };
  }
}
