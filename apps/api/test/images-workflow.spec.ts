import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// =============================================================================
// The container image workflow keeps its supply-chain guarantees
// =============================================================================
// (issue #692)
//
// `.github/workflows/images.yml` builds the api, web, worker and stack-agent
// images. What makes them trustworthy is a handful of lines that are easy to
// delete in a "simplify the workflow" change, and nothing else would notice:
// the build still succeeds, the images still run, and only a consumer who
// tries to verify a signature or read an SBOM finds out.
//
// So this reads the workflow as TEXT (no YAML dependency) and asserts on the
// literal lines: the four roles, the SBOM and provenance attestations, the
// keyless signature of the pushed DIGEST, the OIDC permission, and that
// `latest` is never produced unless the caller asked for the latest channel.
// The plan step's shell is executed for real, and the metadata-action tag
// rules are evaluated against its outputs, so the tag sets in the issue's
// acceptance criteria are checked rather than just described.
//
// An expression form this file does not understand fails the test on purpose:
// extend `evaluate` together with the workflow, so the tag rules stay checked.
// =============================================================================

const repoRoot = resolve(__dirname, '..', '..', '..');
const workflowPath = '.github/workflows/images.yml';

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

const workflow = read(workflowPath);
const lines = workflow.split('\n');

/** The job's steps, each as its block of text (split on `      - ` items). */
function steps(text: string): string[] {
  const out: string[] = [];
  let current: string[] | undefined;
  let inSteps = false;
  for (const line of text.split('\n')) {
    if (/^ {4}steps:\s*$/.test(line)) {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;
    const indent = line.length - line.trimStart().length;
    if (line.trim() === '') {
      current?.push(line);
    } else if (indent < 6) {
      break; // the end of the job
    } else if (/^ {6}- /.test(line)) {
      if (current) out.push(current.join('\n'));
      current = [line];
    } else if (indent === 6) {
      continue; // a comment between two steps
    } else {
      current?.push(line);
    }
  }
  if (current) out.push(current.join('\n'));
  return out;
}

const allSteps = steps(workflow);

function stepById(id: string): string {
  const step = allSteps.find((s) => new RegExp(`^ {8}id: ${id}\\s*$`, 'm').test(s));
  if (!step) throw new Error(`images.yml has no step with id: ${id}`);
  return step;
}

/** The literal `run: |` script of a step, dedented. */
function runScript(step: string): string {
  const stepLines = step.split('\n');
  const start = stepLines.findIndex((l) => /^ {8}run: \|\s*$/.test(l));
  if (start < 0) throw new Error('step has no `run: |` block');
  const body: string[] = [];
  for (const line of stepLines.slice(start + 1)) {
    if (line.trim() !== '' && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
}

describe('images.yml: what it builds', () => {
  const matrix = [
    ...workflow.matchAll(
      /^ {10}- \{ role: ([\w-]+), file: ([\w./-]+), target: ('[^']*'|[\w-]+) \}$/gm
    ),
  ].map((m) => ({ role: m[1], file: m[2], target: m[3] === "''" ? '' : m[3] }));

  it('has exactly the four roles', () => {
    expect(matrix.map((entry) => entry.role)).toEqual(['api', 'web', 'worker', 'stack-agent']);
  });

  it('builds each role from its own Dockerfile, the worker from the production target', () => {
    expect(matrix).toEqual([
      { role: 'api', file: 'apps/api/Dockerfile', target: '' },
      { role: 'web', file: 'apps/web/Dockerfile', target: '' },
      { role: 'worker', file: 'apps/cli/Dockerfile', target: 'production' },
      { role: 'stack-agent', file: 'apps/stack-agent/Dockerfile', target: '' },
    ]);
    for (const entry of matrix) {
      expect(existsSync(resolve(repoRoot, entry.file ?? ''))).toBe(true);
    }
  });

  it('derives a lower-case image name from the repository owner and name', () => {
    const script = runScript(stepById('plan'));
    expect(script).toContain('owner="${GITHUB_REPOSITORY_OWNER,,}"');
    expect(script).toContain('repo="${repo,,}"');
    expect(script).toContain('echo "image=ghcr.io/${owner}/${repo}-${ROLE}"');
  });
});

describe('images.yml: attestations and signature', () => {
  const builds = allSteps.filter((s) => s.includes('uses: docker/build-push-action@'));

  it('has one build step, and it pushes with an SBOM and max provenance', () => {
    expect(builds).toHaveLength(1);
    const build = builds[0] ?? '';
    expect(build).toMatch(/^ {8}id: build$/m);
    expect(build).toMatch(/^ {10}push: true$/m);
    expect(build).toMatch(/^ {10}sbom: true$/m);
    expect(build).toMatch(/^ {10}provenance: mode=max$/m);
  });

  it('signs the pushed digest keyless with cosign, never a tag', () => {
    const signs = allSteps.filter((s) => s.includes('cosign sign'));
    expect(signs).toHaveLength(1);
    const sign = signs[0] ?? '';
    expect(sign).toMatch(/^ {10}DIGEST: \$\{\{ steps\.build\.outputs\.digest \}\}$/m);
    expect(sign).toMatch(/^ {8}run: cosign sign --yes "\$\{IMAGE\}@\$\{DIGEST\}"$/m);
    // Keyless: no key material, no key flag.
    expect(sign).not.toMatch(/--key\b|COSIGN_PRIVATE_KEY|COSIGN_PASSWORD/);
  });

  it('grants id-token: write on the image job only', () => {
    const top = workflow
      .slice(0, workflow.indexOf('\njobs:'))
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(top).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(top).not.toContain('id-token');
    expect(workflow).toMatch(/^ {6}id-token: write\b/m);
    expect(workflow).toMatch(/^ {6}packages: write\b/m);
  });

  it('pins the third-party actions to a commit SHA', () => {
    for (const action of ['sigstore/cosign-installer', 'aquasecurity/trivy-action']) {
      expect(workflow).toMatch(new RegExp(`uses: ${action}@[0-9a-f]{40} # v\\d`));
    }
  });

  it('reports the vulnerability scan to code scanning without blocking', () => {
    const scan = allSteps.find((s) => s.includes('uses: aquasecurity/trivy-action@')) ?? '';
    expect(scan).toMatch(/^ {8}continue-on-error: true$/m);
    expect(scan).toContain("exit-code: '0'");
    expect(scan).toContain('format: sarif');
    expect(workflow).toMatch(/^ {6}security-events: write\b/m);
    expect(workflow).toContain('uses: github/codeql-action/upload-sarif@');
  });
});

// -----------------------------------------------------------------------------
// Tags: run the plan step, then evaluate the metadata-action tag rules
// -----------------------------------------------------------------------------

type Outputs = Record<string, string>;

interface Context {
  outputs: Outputs;
  ref: string;
  sha: string;
}

const SHA = '0123456789abcdef0123456789abcdef01234567';

function runPlan(env: Record<string, string>): { ok: boolean; outputs: Outputs; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'images-plan-'));
  try {
    const script = join(dir, 'plan.sh');
    const output = join(dir, 'output');
    writeFileSync(script, runScript(stepById('plan')));
    writeFileSync(output, '');
    let log = '';
    let ok = true;
    try {
      log = execFileSync('bash', ['-e', script], {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          ROLE: 'worker',
          GITHUB_REPOSITORY_OWNER: 'Example-Owner',
          GITHUB_REPOSITORY: 'Example-Owner/Some-Repo',
          GITHUB_SHA: SHA,
          GITHUB_OUTPUT: output,
          APP_RELEASE: 'false',
          VERSION_INPUT: '',
          CHANNEL_INPUT: '',
          ...env,
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      ok = false;
      log = String((error as { stdout?: string }).stdout ?? error);
    }
    const outputs: Outputs = {};
    for (const line of readFileSync(output, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return { ok, outputs, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Value = string | boolean;

/** GitHub truthiness: false and '' are falsy (the string 'false' is not). */
function truthy(value: Value): boolean {
  return value !== false && value !== '';
}

/**
 * Evaluates the small expression language the tag rules use, with GitHub's
 * `&&` / `||` semantics (each returns an operand, `&&` binds tighter). Throws
 * on anything else.
 */
function evaluate(expression: string, ctx: Context): Value {
  const expr = expression.trim();
  const or = expr.split(/\s+\|\|\s+/);
  if (or.length > 1) {
    const values = or.map((part) => evaluate(part, ctx));
    return values.find(truthy) ?? values[values.length - 1] ?? '';
  }
  const and = expr.split(/\s+&&\s+/);
  if (and.length > 1) {
    const values = and.map((part) => evaluate(part, ctx));
    return values.find((value) => !truthy(value)) ?? values[values.length - 1] ?? '';
  }
  const output = /^steps\.plan\.outputs\.([\w-]+)$/.exec(expr);
  if (output) return ctx.outputs[output[1] ?? ''] ?? '';
  const literal = /^'([^']*)'$/.exec(expr);
  if (literal) return literal[1] ?? '';
  if (expr === 'github.ref') return ctx.ref;
  const format = /^format\('([^']*)', '([^']*)'\)$/.exec(expr);
  if (format) return (format[1] ?? '').replace('{0}', format[2] ?? '');
  const eq = /^(.+?)\s+==\s+(.+)$/.exec(expr);
  if (eq) return evaluate(eq[1] ?? '', ctx) === evaluate(eq[2] ?? '', ctx);
  throw new Error(`images-workflow.spec.ts cannot evaluate \`${expr}\`; extend evaluate()`);
}

function interpolate(text: string, ctx: Context): string {
  return text.replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_, inner: string) => String(evaluate(inner, ctx)));
}

/** The `tags: |` rules of the metadata step, one per line. */
function tagRules(): string[] {
  const meta = stepById('meta').split('\n');
  const start = meta.findIndex((l) => /^ {10}tags: \|\s*$/.test(l));
  const rules: string[] = [];
  for (const line of meta.slice(start + 1)) {
    if (!line.startsWith('            ')) break;
    rules.push(line.trim());
  }
  return rules;
}

/** The tags metadata-action would produce, for the rule types this workflow uses. */
function tagsFor(ctx: Context): string[] {
  const tags: string[] = [];
  const gitTag = ctx.ref.startsWith('refs/tags/v')
    ? ctx.ref.slice('refs/tags/v'.length)
    : undefined;
  for (const rule of tagRules()) {
    const attrs = Object.fromEntries(
      interpolate(rule, ctx)
        .split(',')
        .map((pair) => {
          const at = pair.indexOf('=');
          return [pair.slice(0, at), pair.slice(at + 1)];
        })
    ) as Record<string, string>;
    if (attrs.enable !== 'true' && attrs.enable !== 'false') {
      throw new Error(`tag rule enable must evaluate to true or false: ${rule}`);
    }
    if (attrs.enable !== 'true') continue;
    if (attrs.type === 'raw') tags.push(attrs.value ?? '');
    else if (attrs.type === 'sha') tags.push(`${attrs.prefix ?? ''}${ctx.sha.slice(0, 7)}`);
    else if (attrs.type === 'semver' && gitTag) {
      const [major, minor] = gitTag.split('.');
      tags.push(attrs.pattern === '{{version}}' ? gitTag : `${major}.${minor}`);
    } else if (attrs.type !== 'semver') throw new Error(`unhandled tag type in ${rule}`);
  }
  return tags;
}

/** metadata-action's latest flavour for this run: auto adds latest on a v* semver tag. */
function latestFlavour(ctx: Context): string {
  const meta = stepById('meta');
  const flavor = /^ {12}latest=(.+)$/m.exec(meta);
  if (!flavor) throw new Error('the meta step must set the latest flavour explicitly');
  return interpolate(flavor[1] ?? '', ctx);
}

function plan(env: Record<string, string>, ref: string): Context {
  const result = runPlan({ GITHUB_REF: ref, ...env });
  if (!result.ok) throw new Error(`plan step failed: ${result.log}`);
  return { outputs: result.outputs, ref, sha: SHA };
}

describe('images.yml: tags', () => {
  it('pushes only sha-<sha> from a manual run with no version', () => {
    const ctx = plan({ CHANNEL_INPUT: 'none' }, 'refs/heads/some-branch');
    expect(ctx.outputs.image).toBe('ghcr.io/example-owner/some-repo-worker');
    expect(tagsFor(ctx)).toEqual([`sha-${SHA.slice(0, 7)}`]);
    expect(latestFlavour(ctx)).toBe('false');
  });

  it('pushes <version>, next and sha-<sha> for a next platform release, and no latest', () => {
    const ctx = plan({ VERSION_INPUT: '0.1.0-next.0', CHANNEL_INPUT: 'next' }, 'refs/heads/main');
    const tags = tagsFor(ctx);
    expect(tags).toEqual(['0.1.0-next.0', 'next', `sha-${SHA.slice(0, 7)}`]);
    expect(tags).not.toContain('latest');
    expect(latestFlavour(ctx)).toBe('false');
    expect(ctx.outputs.version).toBe('0.1.0-next.0');
  });

  it('pushes latest only for an explicit latest channel', () => {
    const ctx = plan({ VERSION_INPUT: '1.2.0', CHANNEL_INPUT: 'latest' }, 'refs/heads/main');
    expect(tagsFor(ctx)).toEqual(['1.2.0', 'latest', `sha-${SHA.slice(0, 7)}`]);

    const noChannel = plan({ VERSION_INPUT: '1.2.0' }, 'refs/heads/main');
    expect(tagsFor(noChannel)).not.toContain('latest');
  });

  it('every latest rule is gated on the latest channel or the app scheme on main', () => {
    const latestRules = tagRules().filter((rule) => rule.includes('value=latest'));
    expect(latestRules).toEqual([
      "type=raw,value=latest,enable=${{ steps.plan.outputs.scheme == 'app' && github.ref == format('refs/heads/{0}', 'main') }}",
      "type=raw,value=latest,enable=${{ steps.plan.outputs.channel == 'latest' }}",
    ]);
  });

  it.each([
    [
      'a channel off main',
      { VERSION_INPUT: '0.1.0-next.0', CHANNEL_INPUT: 'next' },
      'refs/heads/feature',
    ],
    ['a version off main', { VERSION_INPUT: '0.1.0-next.0' }, 'refs/heads/feature'],
    ['a channel with no version', { CHANNEL_INPUT: 'next' }, 'refs/heads/main'],
    [
      'latest on a prerelease',
      { VERSION_INPUT: '0.1.0-next.0', CHANNEL_INPUT: 'latest' },
      'refs/heads/main',
    ],
    ['an unknown channel', { VERSION_INPUT: '0.1.0', CHANNEL_INPUT: 'beta' }, 'refs/heads/main'],
    ['a version that is not semver', { VERSION_INPUT: 'v0.1.0; true' }, 'refs/heads/main'],
    [
      'a version on the app scheme',
      { APP_RELEASE: 'true', VERSION_INPUT: '0.1.0' },
      'refs/tags/v1.0.0',
    ],
  ])('refuses %s', (_name, env, ref) => {
    const result = runPlan({ GITHUB_REF: ref, ...env });
    expect(result.ok).toBe(false);
    expect(result.log).toContain('::error');
  });

  it('keeps the app release tag set on a v* tag (semver, major.minor, bare sha)', () => {
    const ctx = plan({ APP_RELEASE: 'true' }, 'refs/tags/v1.4.2');
    expect(tagsFor(ctx)).toEqual(['1.4.2', '1.4', SHA.slice(0, 7)]);
    // metadata-action's latest=auto then adds latest for a stable v* tag, as
    // it did when deploy.yml ran it directly.
    expect(latestFlavour(ctx)).toBe('auto');
    expect(ctx.outputs.version).toBe('1.4.2');
  });

  it('keeps latest on main for the app release scheme', () => {
    const ctx = plan({ APP_RELEASE: 'true' }, 'refs/heads/main');
    expect(tagsFor(ctx)).toEqual([SHA.slice(0, 7), 'latest']);
  });
});

describe('every caller of images.yml grants what its jobs need', () => {
  // A reusable workflow cannot raise its caller's permissions: a caller that
  // grants less than the image job asks for fails before any job starts.
  const required = [
    'contents: read',
    'packages: write',
    'id-token: write',
    'security-events: write',
  ];
  const workflowsDir = resolve(repoRoot, '.github/workflows');
  const callers = readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => {
      const text = readFileSync(join(workflowsDir, name), 'utf8');
      const jobLines = text.split('\n');
      const blocks: { name: string; block: string }[] = [];
      jobLines.forEach((line, index) => {
        if (!/^ {4}uses: \.\/\.github\/workflows\/images\.yml\s*$/.test(line)) return;
        let start = index;
        while (start > 0 && !/^ {2}[\w-]+:\s*$/.test(jobLines[start] ?? '')) start -= 1;
        let end = index + 1;
        while (
          end < jobLines.length &&
          !/^ {2}[\w-]+:\s*$/.test(jobLines[end] ?? '') &&
          !/^\S/.test(jobLines[end] ?? '')
        )
          end += 1;
        blocks.push({
          name: `${name} ${(jobLines[start] ?? '').trim()}`,
          block: jobLines.slice(start, end).join('\n'),
        });
      });
      return blocks;
    });

  it('finds the callers (deploy.yml at least)', () => {
    expect(callers.map((caller) => caller.name)).toContain('deploy.yml build-and-push:');
  });

  it.each(required)('each caller grants %s', (permission) => {
    for (const caller of callers) {
      expect({ caller: caller.name, grants: caller.block.includes(`      ${permission}`) }).toEqual(
        {
          caller: caller.name,
          grants: true,
        }
      );
    }
  });
});

describe('deploy.yml builds its images through images.yml', () => {
  const deploy = read('.github/workflows/deploy.yml');
  const job = deploy.slice(
    deploy.indexOf('  build-and-push:'),
    deploy.indexOf('  deploy-staging:')
  );

  it('calls the reusable workflow with the app release scheme', () => {
    expect(job).toMatch(/^ {4}uses: \.\/\.github\/workflows\/images\.yml$/m);
    expect(job).toMatch(/^ {6}app-release: true$/m);
    expect(job).not.toContain('docker/build-push-action');
  });

  it('keeps the outputs the deploy jobs read', () => {
    const used = new Set(
      [...deploy.matchAll(/needs\.build-and-push\.outputs\.([\w-]+)/g)].map((m) => m[1])
    );
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      expect(lines).toContain(`      ${name}:`);
      expect(workflow).toContain(`value: \${{ jobs.image.outputs.${name} }}`);
    }
  });
});
