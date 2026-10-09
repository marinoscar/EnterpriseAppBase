// The packaged worker-node CLI with ONE test executor added (issue #881).
//
// `createCli` is the call an app's own CLI makes (apps/cli/src/cli.ts); the
// only difference is `nodeExecutors`, which supplies the executor for the
// job type `test-module.cjs` adds to the API. Everything else, `node enroll`,
// `node register`, `node start`, the engine and the daemon, is the package's.
//
// The executor asks for the job's credential through the engine's own API
// object (`context.api.jobSecret`), keeps the material in a local, and returns
// only a digest of it: the credential never reaches the result, a log line, a
// file or an environment variable.

import { createHash } from 'node:crypto';

import { createCli } from '@marinoscar/platform-cli';

const executor = {
  type: 'e2e.worker-cycle',
  requiresInput: false,
  async execute(context) {
    const secret = await context.api.jobSecret(context.nodeId, context.job.id, context.claimToken);
    const token = String(secret.material.token);
    context.log('job credential received', { kind: secret.kind });
    return {
      echo: String(context.params.echo ?? ''),
      secretKind: secret.kind,
      secretSha256: createHash('sha256').update(token).digest('hex'),
      computedBy: 'node',
    };
  },
};

const cli = createCli({
  identity: { name: 'e2e-node', displayName: 'E2E worker node', productName: 'E2E', repoSlug: 'e2e/worker' },
  version: '0.0.0-e2e',
  nodeExecutors: [executor],
});
process.exitCode = await cli.run(process.argv.slice(2));
