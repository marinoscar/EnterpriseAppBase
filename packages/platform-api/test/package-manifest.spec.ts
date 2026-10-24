// The package manifest as a consumer's npm sees it (issue #697, found by the
// consumer smoke in tests/consumer-smoke).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Manifest {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as Manifest;

describe('package.json peers', () => {
  // No source file imports fastify; the peer only states which major an app's
  // HTTP server must be. As a required peer, npm auto-installs the newest
  // fastify 5.x at the consumer's root, beside the exact version
  // @nestjs/platform-fastify pins, and the app ends up with two copies (the
  // single-instance check fails). Optional keeps the range check without the
  // auto-install, so the adapter's own copy is the only one.
  it('declares fastify as an optional peer, keeping its range', () => {
    expect(manifest.peerDependencies?.fastify).toBe('^5');
    expect(manifest.peerDependenciesMeta?.fastify?.optional).toBe(true);
  });
});
