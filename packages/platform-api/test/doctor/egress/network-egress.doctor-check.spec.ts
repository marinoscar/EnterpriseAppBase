import 'reflect-metadata';

import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  AIR_GAPPED_RUNBOOK,
  DEPLOYMENT_NETWORK_SOURCE,
  DoctorCheckRegistry,
  DoctorModule,
  DoctorService,
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  NetworkEgressDoctorCheck,
  PLATFORM_DOCTOR_CATEGORIES,
  describeEgress,
  egressDependency,
  gradeEgress,
} from '../../../src/doctor';
import { createTestPlatformHost } from '../../../src/testing';

function dep(id: string, hosts: string[], extra: Partial<EgressDependency> = {}): EgressDependency {
  return egressDependency({
    id,
    capability: `Cap ${id}`,
    direction: 'server',
    enabled: true,
    required: false,
    degradation: `${id} stops`,
    hosts,
    ...extra,
  });
}

const google = dep('auth.google', ['accounts.google.com', 'oauth2.googleapis.com'], {
  capability: 'Google sign-in',
  required: true,
});
const openai = dep('ai.provider.openai', ['https://api.openai.com/v1'], { capability: 'AI provider: OpenAI' });
const scalar = dep('docs.scalar-cdn', ['cdn.jsdelivr.net', 'fonts.scalar.com'], { capability: 'API reference' });
const ollama = dep('ai.provider.openai-compatible', ['http://ollama:11434/v1']);
const minio = dep('storage.s3', ['http://minio:9000']);
const pushOff = dep('push.web-push', ['fcm.googleapis.com'], { enabled: false });

describe('gradeEgress (#773)', () => {
  describe('online (the default)', () => {
    it('passes with an inventory: counts by scope and the enabled capabilities', () => {
      const outcome = gradeEgress([google, openai, minio, pushOff], 'online');

      expect(outcome.status).toBe('pass');
      expect(outcome.detail).toBe(
        '3 outbound dependencies enabled (2 public, 1 private): Google sign-in, AI provider: OpenAI, Cap storage.s3',
      );
      expect(outcome.data).toEqual({
        network: 'online',
        enabled: 3,
        public: 2,
        private: 1,
        unknown: 0,
        required_public: 1,
        public_ids: 'auth.google,ai.provider.openai',
      });
      expect(outcome.remedy).toBeUndefined();
    });

    it('mentions unknown scopes only when there are some', () => {
      const outcome = gradeEgress([dep('x', [])], 'online');

      expect(outcome.detail).toBe('1 outbound dependency enabled (0 public, 0 private, 1 unknown): Cap x');
    });

    it('passes with nothing enabled', () => {
      expect(gradeEgress([pushOff], 'online')).toMatchObject({
        status: 'pass',
        detail: 'No outbound dependency is enabled',
      });
    });
  });

  describe('air-gapped', () => {
    it('passes when every enabled dependency is private (disabled public ones do not count)', () => {
      const outcome = gradeEgress([ollama, minio, pushOff], 'air-gapped');

      expect(outcome).toMatchObject({
        status: 'pass',
        detail: 'Air-gap ready: every enabled dependency is on a private network',
      });
      expect(outcome.data).toMatchObject({ public: 0, required_public: 0, public_ids: '' });
    });

    it('warns when only optional dependencies are public, with the runbook as remedy', () => {
      const outcome = gradeEgress([openai, scalar, minio], 'air-gapped');

      expect(outcome.status).toBe('warn');
      expect(outcome.detail).toBe(
        '2 public dependencies will not work offline: AI provider: OpenAI (api.openai.com), ' +
          'API reference (cdn.jsdelivr.net, fonts.scalar.com)',
      );
      expect(outcome.remedy).toBe(`Point them at internal hosts or switch them off; see ${AIR_GAPPED_RUNBOOK}.`);
      expect(outcome.data).toMatchObject({ public_ids: 'ai.provider.openai,docs.scalar-cdn' });
    });

    it('fails when a required dependency is public, naming the host and the runbook section', () => {
      const outcome = gradeEgress([google, openai], 'air-gapped');

      expect(outcome.status).toBe('fail');
      expect(outcome.detail).toBe(
        'Google sign-in needs accounts.google.com, oauth2.googleapis.com, which an air-gapped network cannot reach; ' +
          '1 other public dependency will not work offline',
      );
      expect(outcome.remedy).toContain(AIR_GAPPED_RUNBOOK);
      expect(outcome.remedy).toContain('"auth.google"');
      expect(outcome.data).toMatchObject({ required_public: 1 });
    });

    it('counts an unknown scope as public (fail closed)', () => {
      const outcome = gradeEgress([dep('mystery', ['not a host'])], 'air-gapped');

      expect(outcome.status).toBe('warn');
      expect(outcome.detail).toContain('Cap mystery (an unknown host)');
      expect(gradeEgress([dep('mystery', [], { required: true })], 'air-gapped').status).toBe('fail');
    });
  });

  it('puts scalars only in data, and caps public_ids at 500 characters', () => {
    const many = Array.from({ length: 80 }, (_, i) => dep(`some.long.dependency.id.${i}`, ['api.example.com']));
    const outcome = gradeEgress(many, 'air-gapped');

    for (const value of Object.values(outcome.data ?? {})) {
      expect(['string', 'number', 'boolean'].includes(typeof value) || value === null).toBe(true);
    }
    expect(String(outcome.data?.public_ids).length).toBeLessThanOrEqual(500);
  });
});

describe('describeEgress (#773)', () => {
  it('runs every contributor and turns a throw into one unknown entry under its id', async () => {
    const registry = new EgressRegistry();
    const errors: string[] = [];
    registry.register({ id: 'ok', describe: async () => [openai] });
    registry.register({
      id: 'broken',
      describe: async () => {
        throw new Error('settings unreadable');
      },
    });
    registry.register({ id: 'weird', describe: async () => 'nope' as unknown as EgressDependency[] });

    const deps = await describeEgress(registry, (id, message) => errors.push(`${id}: ${message}`));

    expect(deps.map((d) => d.id)).toEqual(['ai.provider.openai', 'broken', 'weird']);
    expect(deps[1]).toMatchObject({ enabled: true, scope: 'unknown', hosts: [], required: false });
    expect(errors).toEqual(['broken: settings unreadable', 'weird: describe() did not return an array']);
  });

  it('calls contributors in parallel', async () => {
    const registry = new EgressRegistry();
    let inFlight = 0;
    let peak = 0;
    const slow = (id: string): EgressContributor => ({
      id,
      describe: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return [];
      },
    });
    registry.register(slow('a'));
    registry.register(slow('b'));

    await describeEgress(registry);

    expect(peak).toBe(2);
  });
});

describe('NetworkEgressDoctorCheck, contributed by the app, over DoctorModule.forRoot (#773)', () => {
  function contributorModule(deps: EgressDependency[]) {
    @Injectable()
    class Contributor implements EgressContributor, OnModuleInit {
      readonly id = 'test';
      constructor(private readonly egress: EgressRegistry) {}
      onModuleInit(): void {
        this.egress.register(this);
      }
      async describe(): Promise<EgressDependency[]> {
        return deps;
      }
    }

    @Module({ providers: [Contributor] })
    class FeatureModule {}
    return FeatureModule;
  }

  /** The app's deployment module: binds the source (optionally) and contributes the check. */
  function deploymentModule(network?: 'online' | 'air-gapped') {
    const source = network ? [{ provide: DEPLOYMENT_NETWORK_SOURCE, useValue: { network } }] : [];
    @Global()
    @Module({ providers: [...source, NetworkEgressDoctorCheck], exports: source.map((p) => p.provide) })
    class DeploymentModule {}
    return DeploymentModule;
  }

  async function boot(deps: EgressDependency[], network?: 'online' | 'air-gapped') {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DoctorModule.forRoot({ host: createTestPlatformHost() }),
        contributorModule(deps),
        deploymentModule(network),
      ],
    }).compile();
    await moduleRef.init();
    return moduleRef;
  }

  it('registers network.egress in the network category, which is the last shipped category', async () => {
    const moduleRef = await boot([openai]);
    const check = moduleRef.get(DoctorCheckRegistry).get('network.egress');

    expect(check).toBeInstanceOf(NetworkEgressDoctorCheck);
    expect(check).toMatchObject({
      category: 'network',
      label: 'Outbound dependencies (air-gap readiness)',
      timeoutMs: 5000,
    });
    expect(PLATFORM_DOCTOR_CATEGORIES[PLATFORM_DOCTOR_CATEGORIES.length - 1]).toBe('network');
    await moduleRef.close();
  });

  it('is not registered by forRoot itself: the app contributes it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DoctorModule.forRoot({ host: createTestPlatformHost() })],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(DoctorCheckRegistry).get('network.egress')).toBeUndefined();
    expect(moduleRef.get(EgressRegistry)).toBeInstanceOf(EgressRegistry);
    await moduleRef.close();
  });

  it('is online without a bound DEPLOYMENT_NETWORK_SOURCE', async () => {
    const moduleRef = await boot([google, openai]);
    const report = await moduleRef.get(DoctorService).run({ category: 'network', refresh: true });

    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ id: 'network.egress', status: 'pass' });
    await moduleRef.close();
  });

  it('grades the inventory when the app binds air-gapped', async () => {
    const moduleRef = await boot([google, openai], 'air-gapped');
    const report = await moduleRef.get(DoctorService).run({ category: 'network', refresh: true });

    expect(report.checks[0]).toMatchObject({ id: 'network.egress', status: 'fail' });
    await moduleRef.close();
  });
});
