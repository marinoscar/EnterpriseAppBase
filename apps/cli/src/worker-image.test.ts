import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// =============================================================================
// The worker node image ships every platform package it needs (issue #989)
// =============================================================================
//
// apps/cli/Dockerfile builds from the repository root. `npm ci --workspace=cli`
// validates every `--workspace=` the CLI's `prebuild` names, so a platform
// package that is built there but never COPYed in the `deps` stage fails the
// image build ("No workspaces found"), and one whose dist/ is not copied into
// the `production` stage builds clean and dies at boot with
// ERR_MODULE_NOT_FOUND. This is the worker-image counterpart of the API image
// guard in apps/api/test/production-image.spec.ts.
//
// The set is computed from the real manifests (never a hard-coded list), so it
// also catches the NEXT platform package the CLI comes to depend on.
// =============================================================================

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');

interface Manifest {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const PREFIX = '@marinoscar/';
const isPlatform = (name: string): boolean => name.startsWith(`${PREFIX}platform-`);
const dirOf = (name: string): string => `packages/${name.slice(PREFIX.length)}`;
const manifestOf = (path: string): Manifest => JSON.parse(read(path)) as Manifest;

const cliManifest = manifestOf('apps/cli/package.json');

// Packages the CLI's `prebuild` builds: `--workspace=@marinoscar/platform-*`.
const builtByPrebuild = [
  ...(cliManifest.scripts?.prebuild ?? '').matchAll(/--workspace=(@marinoscar\/platform-[\w-]+)/g),
].map((m) => m[1]!);

// Transitive closure over `dependencies`, plus everything prebuild builds.
const needed: string[] = [];
for (const queue = [...Object.keys(cliManifest.dependencies ?? {}).filter(isPlatform), ...builtByPrebuild]; queue.length > 0; ) {
  const name = queue.shift()!;
  if (needed.includes(name)) continue;
  needed.push(name);
  queue.push(...Object.keys(manifestOf(`${dirOf(name)}/package.json`).dependencies ?? {}).filter(isPlatform));
}

const dockerfile = read('apps/cli/Dockerfile');
const stageOf = (name: string): string => {
  const start = dockerfile.search(new RegExp(`^FROM .* AS ${name}$`, 'm'));
  expect(start, `stage "${name}" not found in apps/cli/Dockerfile`).toBeGreaterThanOrEqual(0);
  const rest = dockerfile.slice(start + 1);
  const next = rest.search(/^FROM /m);
  return dockerfile.slice(start, next < 0 ? undefined : start + 1 + next);
};
const depsStage = stageOf('deps');
const productionStage = stageOf('production');

describe('the worker node image ships the platform packages it depends on', () => {
  it('needs at least platform-cli, platform-infra and platform-contract (guards a vacuous pass)', () => {
    expect(needed).toEqual(
      expect.arrayContaining([
        `${PREFIX}platform-cli`,
        `${PREFIX}platform-infra`,
        `${PREFIX}platform-contract`,
      ]),
    );
  });

  it('copies every needed package into the deps stage before npm ci', () => {
    const installAt = depsStage.indexOf('RUN npm ci');
    expect(installAt).toBeGreaterThan(-1);
    const missing = needed.filter((name) => {
      const dir = dirOf(name);
      const at = depsStage.indexOf(`COPY ${dir} ./${dir}/`);
      return at < 0 || at > installAt;
    });

    expect(missing).toEqual([]);
  });

  it("copies the dist of every package the CLI's prebuild builds into the production stage", () => {
    expect(builtByPrebuild.length).toBeGreaterThan(0);
    const missing = builtByPrebuild.filter((name) => {
      const dir = dirOf(name);
      return !productionStage.includes(`COPY --from=build /app/${dir}/dist ./${dir}/dist`);
    });

    expect(missing).toEqual([]);
  });
});
