// The Doctor kit proves a check, and fails on a planted violation (PP-14.26).

import { DoctorCheckRegistry } from '../../../src/doctor';
import type { DoctorCheck, DoctorCheckOutcome } from '../../../src/doctor';
import {
  DOCTOR_FORBIDDEN_SERVICES,
  auditDoctorChecks,
  createRecordingPrisma,
  createWriteFailingStorage,
  describeDoctorCheckConformance,
  doctorReadOnlySuite,
  findReadOnlyViolations,
} from '../../../src/doctor/testing';
import type { DoctorCheckFactory, DoctorConformanceFixture, DoctorReadOnlyDoubles } from '../../../src/doctor/testing';
import { conformanceSuites, runPlatformConformance } from '../../../src/testing';
import { outcome, recordingTestApi } from '../../support/conformance-harness';

const PASS: DoctorCheckOutcome = { status: 'pass', detail: 'fine' };

/** A check over the doubles, with the body of `run` supplied by the test. */
function checkWith(run: (doubles: DoctorReadOnlyDoubles) => Promise<DoctorCheckOutcome>, doubles: DoctorReadOnlyDoubles, id = 'example.thing'): DoctorCheck {
  return { id, category: 'example', label: 'Example', run: () => run(doubles) };
}

/** Runs the kit for `factory` on a recording API and returns the failures by test title. */
async function kitFailures(factory: DoctorCheckFactory, scenarios?: Parameters<typeof describeDoctorCheckConformance>[2]): Promise<Record<string, string>> {
  const { api, tests } = recordingTestApi();
  describeDoctorCheckConformance('example.thing', factory, { ...scenarios, testApi: api });
  const failures: Record<string, string> = {};
  for (const test of tests) {
    const error = await outcome(test);
    if (error) failures[test.name.replace('Doctor check conformance: example.thing > ', '')] = error.message;
  }
  return failures;
}

describe('describeDoctorCheckConformance', () => {
  it('registers four cases per scenario and passes a read-only check', async () => {
    const { api, tests } = recordingTestApi();
    describeDoctorCheckConformance('example.thing', ({ prisma }) => checkWith(async () => (await prisma.client.job.count(), PASS), { prisma } as never), { testApi: api });

    expect(tests).toHaveLength(4);
    expect(await kitFailures(({ prisma }) => checkWith(async () => (await prisma.client.job.count(), PASS), { prisma } as never))).toEqual({});
  });

  it('prefixes titles with the scenario and holds each scenario to its expected statuses', async () => {
    const factory: DoctorCheckFactory = ({ prisma }) =>
      checkWith(async () => ((await prisma.client.setting.count()) > 0 ? PASS : { status: 'skip', detail: 'off' }), { prisma } as never);

    const failures = await kitFailures(factory, {
      scenarios: [
        { name: 'on', prisma: { results: { 'setting.count': 2 } }, expectStatus: 'pass' },
        { name: 'off', expectStatus: 'skip' },
        { name: 'wrong', expectStatus: ['warn', 'fail'] },
      ],
    });

    expect(Object.keys(failures)).toEqual(['[wrong] answers one of the statuses the scenario expects']);
    expect(failures['[wrong] answers one of the statuses the scenario expects']).toContain('expected warn or fail, got skip');
  });

  it('fails a check that writes through Prisma', async () => {
    const failures = await kitFailures(({ prisma }) => checkWith(async () => (await prisma.client.setting.upsert({}), PASS), { prisma } as never));

    expect(Object.keys(failures)).toContain('is read-only: it writes nothing through Prisma and nothing to object storage');
  });

  it('fails a check that writes to object storage', async () => {
    const failures = await kitFailures(({ storage }) => checkWith(async () => (await storage.provider.upload('probe', null, {}), PASS), { storage } as never));

    expect(Object.keys(failures)).toContain('is read-only: it writes nothing through Prisma and nothing to object storage');
  });

  it('fails a check that throws, one with no remedy on fail, and one that leaks a seeded secret', async () => {
    const thrower = await kitFailures(() => ({ id: 'example.thing', category: 'example', label: 'E', run: async () => Promise.reject(new Error('boom')) }));
    const noRemedy = await kitFailures(() => ({ id: 'example.thing', category: 'example', label: 'E', run: async () => ({ status: 'fail', detail: 'down' }) }));
    const leaky = await kitFailures(() => ({ id: 'example.thing', category: 'example', label: 'E', run: async () => ({ status: 'pass', detail: 'key sk-secret-1 ok' }) }), {
      scenarios: [{ name: 'seeded', secrets: ['sk-secret-1'] }],
    });

    expect(thrower['completes within its timeout, never throws and returns a valid outcome with a remedy on warn and fail']).toContain('threw');
    expect(noRemedy['completes within its timeout, never throws and returns a valid outcome with a remedy on warn and fail']).toContain('without a remedy');
    expect(Object.keys(leaky)).toEqual(['[seeded] completes within its timeout, never throws and returns a valid outcome with a remedy on warn and fail']);
  });

  it('fails a check with a malformed identity', async () => {
    const failures = await kitFailures(() => ({ id: 'NotDotted', category: 'example', label: 'E', run: async () => PASS }));

    expect(Object.keys(failures)).toEqual(['describes itself: a dotted id, a category, a label, a root-relative settings path, a sane timeout']);
  });

  it('lets a scenario build the check differently', async () => {
    const failures = await kitFailures(() => checkWith(async () => PASS, {} as never), {
      scenarios: [{ name: 'broken build', build: () => ({ id: 'bad', category: 'c', label: 'l', run: async () => PASS }) }],
    });

    expect(Object.keys(failures)).toEqual(['[broken build] describes itself: a dotted id, a category, a label, a root-relative settings path, a sane timeout']);
  });
});

describe('the doctor-read-only suite', () => {
  /** A fixture whose "app" holds `checks` in a real registry, built over the doubles the suite hands it. */
  function fixtureOf(build: (doubles: DoctorReadOnlyDoubles) => DoctorCheck[]): DoctorConformanceFixture {
    return {
      createContext: async (doubles) => {
        const registry = new DoctorCheckRegistry();
        for (const check of build(doubles)) registry.register(check);
        return { app: { get: <T>() => registry as unknown as T } };
      },
      closeContext: async () => undefined,
    };
  }

  const clean = (doubles: DoctorReadOnlyDoubles): DoctorCheck[] => [
    checkWith(async () => (await doubles.prisma.client.job.count(), PASS), doubles, 'example.reads-prisma'),
    checkWith(async () => (await doubles.storage.provider.exists('k'), PASS), doubles, 'example.reads-storage'),
  ];

  it('registers under its id and option key', () => {
    expect(doctorReadOnlySuite.id).toBe('doctor-read-only');
    expect(conformanceSuites.has('doctor-read-only')).toBe(true);
  });

  it('refuses to run without a fixture, and an exemption without a reason', () => {
    const { api } = recordingTestApi();
    const run = (options: unknown) => () => runPlatformConformance({ sourceRoots: ['/x'], suites: { doctorReadOnly: options as never }, testApi: api });

    expect(run({})).toThrow('pass `fixture`');
    expect(run({ fixture: fixtureOf(clean), exempt: [{ id: 'example.reads-prisma', why: ' ' }] })).toThrow('has no reason');
  });

  it('an opt-out needs a reason, like every suite', () => {
    const { api } = recordingTestApi();

    expect(() => runPlatformConformance({ sourceRoots: ['/x'], suites: { doctorReadOnly: { skip: '' } }, testApi: api })).toThrow('without a reason');
  });

  it('boots the app with writes allowed, then refuses them and forgets what the boot wrote before the first check', async () => {
    let bootWrites = 0;
    const fixture: DoctorConformanceFixture = {
      createContext: async (doubles) => {
        await doubles.prisma.client.organization.upsert({});
        await doubles.storage.provider.upload('boot/marker', null, {});
        bootWrites = doubles.prisma.violations().length + doubles.storage.violations().length;
        const registry = new DoctorCheckRegistry();
        registry.register(checkWith(async () => (await doubles.prisma.client.job.count(), PASS), doubles, 'example.reads'));
        return { app: { get: <T>() => registry as unknown as T } };
      },
      closeContext: async () => undefined,
    };
    const describeAll = jest.fn();
    const tests: Array<() => unknown> = [];
    const hooks: Array<() => unknown> = [];
    const runner = globalThis as { beforeAll: unknown; afterAll: unknown };
    const realHooks = { beforeAll: runner.beforeAll, afterAll: runner.afterAll };
    runner.beforeAll = (fn: () => unknown) => void hooks.push(fn);
    runner.afterAll = () => undefined;
    try {
      doctorReadOnlySuite.register(
        { describe: (_name: string, fn: () => void) => (describeAll(), fn()), it: (_name: string, fn: () => unknown) => void tests.push(fn), expect } as never,
        { sourceRoots: [] },
        { fixture, minChecks: 1 },
      );
    } finally {
      Object.assign(runner, realHooks);
    }

    for (const hook of hooks) await hook();
    for (const test of tests) await test();

    expect(bootWrites).toBe(2);
  });

  // The suite's own tree registers `beforeAll`/`afterAll` on the runner's globals, so the passing case runs under Jest.
  describe('over clean checks (registered on the runner)', () => {
    doctorReadOnlySuite.register(
      { describe, it, expect } as never,
      { sourceRoots: [] },
      { fixture: fixtureOf(clean), minChecks: 2 },
    );
  });

  describe('over planted violators (the audit the suite runs)', () => {
    async function audit(build: (doubles: DoctorReadOnlyDoubles) => DoctorCheck[], options = {}) {
      const doubles: DoctorReadOnlyDoubles = { prisma: createRecordingPrisma(), storage: createWriteFailingStorage() };
      return { doubles, audits: await auditDoctorChecks(build(doubles), doubles, options) };
    }

    it('finds nothing in clean checks', async () => {
      const { audits } = await audit(clean);

      expect(Object.values(findReadOnlyViolations(audits)).flat()).toEqual([]);
    });

    it('catches a Prisma write, a raw write, a storage write and a held test service, attributed to the right check', async () => {
      class StorageConnectionTestService {}
      const { audits } = await audit((doubles) => [
        checkWith(async () => (await doubles.prisma.client.setting.upsert({}), PASS), doubles, 'bad.upsert'),
        checkWith(async () => (await doubles.prisma.client.$executeRaw`DELETE FROM jobs`, PASS), doubles, 'bad.raw'),
        checkWith(async () => (await doubles.storage.provider.delete('k'), PASS), doubles, 'bad.storage'),
        { ...checkWith(async () => PASS, doubles, 'bad.service'), connection: new StorageConnectionTestService() } as DoctorCheck,
        checkWith(async () => PASS, doubles, 'good.one'),
      ]);
      const found = findReadOnlyViolations(audits);

      expect(found.prisma).toEqual(['bad.upsert wrote through Prisma: setting.upsert', 'bad.raw wrote through Prisma: $executeRaw']);
      expect(found.storage).toEqual(['bad.storage wrote to object storage: delete']);
      expect(found.services).toEqual([expect.stringContaining('bad.service holds the side-effecting StorageConnectionTestService')]);
    });

    it('finds a test service one level down, and honours an app-added service name', async () => {
      class Facade {
        constructor(readonly inner: object) {}
      }
      class OrderProbeService {}
      const { audits } = await audit(
        (doubles) => [{ ...checkWith(async () => PASS, doubles, 'bad.nested'), probe: new Facade(new OrderProbeService()) } as DoctorCheck],
        { forbiddenServices: [...DOCTOR_FORBIDDEN_SERVICES, 'OrderProbeService'] },
      );

      expect(findReadOnlyViolations(audits).services).toEqual([expect.stringContaining('OrderProbeService')]);
    });

    it('does not grade the outcome of a check whose dependency did not pass, but still catches its writes', async () => {
      const { audits } = await audit((doubles) => [
        { ...checkWith(async () => ({ status: 'fail', detail: 'down', remedy: 'Open /admin/settings/x and fix the host.' }), doubles, 'dep.down') },
        { ...checkWith(async () => Promise.reject(new Error('assumes dep.down passed')), doubles, 'needs.dep'), dependsOn: ['dep.down'] },
        { ...checkWith(async () => (await doubles.prisma.client.audit.create({}), PASS), doubles, 'writes.when.blocked'), dependsOn: ['needs.dep'] },
        { ...checkWith(async () => Promise.reject(new Error('dependency gone')), doubles, 'orphan'), dependsOn: ['not.registered'] },
        { ...checkWith(async () => Promise.reject(new Error('really broken')), doubles, 'free.thrower') },
      ]);
      const found = findReadOnlyViolations(audits);

      expect(audits.map((audit) => [audit.id, audit.blockedBy])).toEqual([
        ['dep.down', undefined],
        ['needs.dep', 'dep.down'],
        ['writes.when.blocked', 'needs.dep'],
        ['orphan', 'not.registered'],
        ['free.thrower', undefined],
      ]);
      expect(found.outcomes).toEqual([expect.stringContaining('free.thrower threw "really broken"')]);
      expect(found.prisma).toEqual(['writes.when.blocked wrote through Prisma: audit.create']);
    });

    it('grades a check whose dependency passed', async () => {
      const { audits } = await audit((doubles) => [
        checkWith(async () => PASS, doubles, 'dep.up'),
        { ...checkWith(async () => Promise.reject(new Error('boom')), doubles, 'needs.dep'), dependsOn: ['dep.up'] },
      ]);

      expect(audits[1]!.blockedBy).toBeUndefined();
      expect(findReadOnlyViolations(audits).outcomes).toEqual([expect.stringContaining('needs.dep threw "boom"')]);
    });

    it('reports a throwing check and a stale exemption, and leaves an argued exemption out', async () => {
      const { audits } = await audit((doubles) => [
        checkWith(async () => Promise.reject(new Error('boom')), doubles, 'bad.throws'),
        checkWith(async () => (await doubles.prisma.client.audit.create({}), PASS), doubles, 'exempt.writer'),
      ]);
      const found = findReadOnlyViolations(audits, [
        { id: 'exempt.writer', why: 'It records the doctor run itself, by design.' },
        { id: 'gone.check', why: 'Removed last release.' },
      ]);

      expect(found.outcomes).toEqual([expect.stringContaining('bad.throws threw "boom"')]);
      expect(found.prisma).toEqual([]);
      expect(found.staleExemptions).toEqual([expect.stringContaining('gone.check is exempt but no check with that id is registered')]);
    });
  });
});
