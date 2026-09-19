import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runStatusCommand } from '../../commands/deploy.js';
import { isDeployment, resolveEnvPath } from '../deployment-evidence.js';
import { parseEnvExample, parseEnvFile } from '../env-spec.js';
import { runInstall } from '../install.js';
import { readState } from '../state.js';
import {
  createFakeVps,
  listenForProbe,
  serveHealth,
  unattendedAnswers,
} from './fake-vps.js';

// =============================================================================
// The harness drives the REAL pipeline  (issue #407, epic #397)
// =============================================================================
//
// Every deploy test before this one mocked at the edges, so the thing under
// test was never the pipeline. Here `runInstall` runs its real steps in their
// real order against a real temp directory; only the subprocesses are faked.
//
// ⚠ These tests can never catch a Docker-level break -- the argv is answered,
// not executed. That is what `.github/workflows/deploy-e2e.yml` is for, and
// the two are complements, not alternatives.
// =============================================================================

/**
 * ⚠ THE REAL `.env.example`, NOT A TOY ONE.
 *
 * A fixture template drifts from the real one silently, and the wizard's whole
 * job is to answer THAT file. Reading it here means a variable added to the
 * template with no metadata, or a validator nothing can satisfy, fails in this
 * one-second test rather than on a server.
 */
const TEMPLATE = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose', '.env.example'),
  'utf8',
);

const SPECS = parseEnvExample(TEMPLATE);

/**
 * Every essential key answered, which is what an unattended run must supply.
 * See `unattendedAnswers`: the wizard deliberately will not take a template
 * default for an essential key, nor generate a secret without a terminal.
 */
/**
 * A real listening socket for `database-reachable`'s real TCP probe, and the
 * host/port the answers point at. See `listenForProbe`.
 */
let probe: Awaited<ReturnType<typeof listenForProbe>>;
let api: Awaited<ReturnType<typeof serveHealth>>;
let ANSWERS: Map<string, string>;

beforeAll(async () => {
  probe = await listenForProbe();
  api = await serveHealth();
  ANSWERS = unattendedAnswers(
    SPECS,
    new Map([
      ['POSTGRES_HOST', '127.0.0.1'],
      ['POSTGRES_PORT', String(probe.port)],
    ]),
  );
});

afterAll(async () => {
  await probe.close();
  await api.close();
});

function install(vps: ReturnType<typeof createFakeVps>) {
  return runInstall({
    deployRoot: vps.deployRoot,
    bindPort: api.port,
    proxyRoot: join(vps.appsRoot, 'proxy'),
    domain: 'app.example.test',
    repo: 'https://example.test/o/r',
    ref: 'main',
    runCommand: vps.runCommand,
    // ⚠ POSTGRES_PORT carries a template default, so `unattendedAnswers` does
    // not answer it and the override above never reaches the file. Supplied
    // here instead, which is also what `--answer` does on a real run.
    answers: new Map([...ANSWERS, ['POSTGRES_PORT', String(probe.port)]]),
    nonInteractive: true,
    skipDoctor: true,
    skipProxy: true,
    skipSeed: true,
    // ⚠ OFF BY DEFAULT HERE. The version step COMMITS, and these temp deploy
    // roots have no git repository for it to commit into -- so leaving it on
    // would make every test in this file fail on a fact about the fixture
    // rather than about the pipeline. The one test that is about versioning
    // turns it on and builds a real repository for it.
    noVersionBump: true,
  });
}

function vpsWithTemplate(): ReturnType<typeof createFakeVps> {
  return createFakeVps({
    envExample: TEMPLATE,
    routes: [
      // Health: the pipeline waits for these, and an unanswered probe would
      // hang the test rather than fail it.
      {
        match: (invocation) => invocation.argv.includes('curl'),
        answer: '200',
      },
    ],
  });
}

describe('the fake VPS harness', () => {
  it('drives the real install pipeline to completion', async () => {
    const vps = vpsWithTemplate();

    const result = await install(vps);

    expect(result.deployRoot).toBe(vps.deployRoot);

    // ⚠ FOUND THROUGH `resolveEnvPath`, NOT AT A HARDCODED PATH. That helper
    // knows both the current location and the legacy one, and asserting on a
    // literal path here would make this test a second, quieter opinion about
    // where the file lives -- the exact disagreement it exists to catch.
    const envPath = resolveEnvPath(vps.deployRoot);
    expect(envPath).toBeDefined();
    expect(existsSync(envPath as string)).toBe(true);
  });

  it('writes the .env at 0600, because it holds every secret', async () => {
    const vps = vpsWithTemplate();
    await install(vps);

    // ⚠ Asserted on the REAL file, not on the argument passed to the writer.
    // `mode` on writeFileSync applies only when a file is CREATED, so a
    // rewritten pre-existing `.env` kept whatever mode it had -- which is
    // exactly the bug this permission check exists to catch.
    expect(statSync(resolveEnvPath(vps.deployRoot) as string).mode & 0o777).toBe(0o600);
  });

  it('carries the operator answers into the file rather than the defaults', async () => {
    const vps = vpsWithTemplate();
    await install(vps);

    const contents = readFileSync(resolveEnvPath(vps.deployRoot) as string, 'utf8');

    const written = parseEnvFile(contents);

    expect(written.get('POSTGRES_PASSWORD')).toBe(ANSWERS.get('POSTGRES_PASSWORD'));

    // ⚠ NOT the template placeholder. `postgres` is the value nobody chose,
    // and a run that writes it has silently ignored what was supplied -- which
    // is how a deployment ends up serving with the password from the example
    // file. `unattendedAnswers` never produces it, so this is a real
    // distinction rather than a tautology.
    expect(written.get('POSTGRES_PASSWORD')).not.toBe('postgres');
    expect(written.get('INITIAL_ADMIN_EMAIL')).toBe(ANSWERS.get('INITIAL_ADMIN_EMAIL'));
  });

  it('reproduces the template section banners, so the file diffs against it', async () => {
    const vps = vpsWithTemplate();
    await install(vps);

    const contents = readFileSync(resolveEnvPath(vps.deployRoot) as string, 'utf8');

    // ⚠ DERIVED FROM WHAT WAS ACTUALLY WRITTEN, not transcribed and not taken
    // from the whole template.
    //
    // Transcribing banner names drifts silently the moment a section is
    // renamed. But asserting EVERY template section is also wrong, and wrongly
    // strict: a section whose keys were all skipped -- optional variables the
    // operator declined -- correctly produces no banner, because a banner over
    // nothing is noise. So the invariant is narrower and truer: every section
    // that has a key in the file has its banner in the file.
    const written = parseEnvFile(contents);
    const sections = SPECS.filter((spec) => written.has(spec.key))
      .map((spec) => spec.section)
      .filter((section, index, all) => section !== '' && all.indexOf(section) === index);

    expect(sections.length).toBeGreaterThan(2);
    for (const section of sections) {
      expect(contents).toContain(`# ${section}`);
    }
  });

  it('runs every compose command under an explicit project name', async () => {
    const vps = vpsWithTemplate();
    await install(vps);

    const composeCalls = vps.calls('docker', 'compose');
    expect(composeCalls.length).toBeGreaterThan(0);

    // ⚠ Without `-p`, Compose derives the project from the compose file's
    // DIRECTORY -- which is `compose` for every deployment on the host, so two
    // applications collide on one project and each `up -d` fights the other.
    for (const call of composeCalls) {
      expect(call.argv).toContain('-p');
    }
  });

  it('records the state file only after the pipeline succeeds', async () => {
    const vps = vpsWithTemplate();

    expect(readState(vps.deployRoot)).toBeUndefined();
    await install(vps);
    expect(readState(vps.deployRoot)).toBeDefined();
  });

  it('records the partial state when a step fails, so --resume has something to resume', async () => {
    const vps = vpsWithTemplate();
    // ⚠ The build is the realistic failure: long, the step people actually
    // watch fail, and late enough that several steps already completed --
    // which is the entire point of recording them.
    vps.route(
      (invocation) =>
        invocation.argv[0] === 'docker' && invocation.argv.includes('build'),
      { fail: new Error('build failed') },
    );

    await expect(install(vps)).rejects.toThrow();

    // ⚠ WITHOUT THIS RECORD `--resume` RESUMED NOTHING. `completedSteps` was
    // written only on the SUCCESS path, so the one run that needs resuming --
    // a failed one -- left no trace of its progress, and the flag the error
    // message recommends in its very next line skipped zero steps and rebuilt
    // everything. The message was true about intent and false about behaviour.
    const state = readState(vps.deployRoot);
    expect(state?.lastOutcome).toBe('failure');
    expect(state?.lastFailedStep).toBeDefined();
    expect((state?.completedSteps ?? []).length).toBeGreaterThan(0);
  });

  it('marks a successful run as such rather than leaving it to be inferred', async () => {
    const vps = vpsWithTemplate();
    await install(vps);

    const state = readState(vps.deployRoot);
    expect(state?.lastOutcome).toBe('success');
    // ⚠ `lastFailedStep` must be ABSENT, not stale. A success still carrying
    // the previous run's failed step would have `decideResume` offer to
    // continue from a step that has since completed.
    expect(state?.lastFailedStep).toBeUndefined();
  });

  it('refuses to answer a command no route covers', async () => {
    const vps = createFakeVps({ routes: [] });

    // ⚠ The alternative -- a default "exit 0, empty stdout" -- is what makes a
    // fake dangerous: a step shelling into something the test author never
    // considered would pass, silently, having done nothing.
    await expect(
      vps.runCommand(['certbot', 'certonly'], { cwd: vps.deployRoot }),
    ).rejects.toThrow(/nothing answers/);
  });

  it('lets a later route override an earlier default', async () => {
    const vps = createFakeVps();
    vps.route(['git', 'rev-parse', 'HEAD'], 'f'.repeat(40));

    const result = await vps.runCommand(['git', 'rev-parse', 'HEAD'], {
      cwd: vps.deployRoot,
    });

    expect(result.stdout).toBe('f'.repeat(40));
  });
});

describe('deploy status asks the deployment, not the bookkeeping about it', () => {
  it('reports on a deployment whose state file is gone', async () => {
    const vps = vpsWithTemplate();
    await install(vps);

    // ⚠ The clone is FAKED here -- `git clone` is answered, not executed -- so
    // the `.git` a real checkout would have has to be laid down by hand. It is
    // half of what `isDeployment` asks for, and the half this fixture cannot
    // produce on its own.
    mkdirSync(join(vps.deployRoot, 'repo', '.git'), { recursive: true });

    // The record is what `install` wrote; the deployment is the checkout and
    // the `.env`. Removing the first leaves the second entirely intact.
    rmSync(join(vps.deployRoot, '.appctl-deploy.json'), { force: true });
    expect(readState(vps.deployRoot)).toBeUndefined();
    expect(isDeployment(vps.deployRoot)).toBe(true);

    // ⚠ THE DEFECT THIS PINS, and it is the same wrong question `update` used
    // to ask, from the other side. Guarding on the state file meant a
    // deployment whose record was lost -- containers up, certificate issued,
    // site serving -- was reported as "No deployment found" by the ONE command
    // an operator runs when something is wrong.
    await expect(
      runStatusCommand(
        { root: vps.deployRoot, port: String(api.port), json: true, color: false },
        { runCommand: vps.runCommand, stdout: sink(), stderr: sink() },
      ),
    ).resolves.toBeUndefined();
  });

  it('still refuses when nothing is installed there at all', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'appctl-fake-vps-empty-'));

    // ⚠ The distinction is preserved, just asked of the deployment rather than
    // of the record: "nothing installed" is a usage problem, "installed and
    // unhealthy" is not, and a monitoring script must tell them apart.
    await expect(
      runStatusCommand(
        { root: empty, port: String(api.port), json: true, color: false },
        { runCommand: vpsWithTemplate().runCommand, stdout: sink(), stderr: sink() },
      ),
    ).rejects.toThrow(/No deployment found/);
  });
});

/** A writable stream that keeps nothing; the assertions are on the outcome. */
function sink(): NodeJS.WritableStream {
  return { write: () => true } as unknown as NodeJS.WritableStream;
}
