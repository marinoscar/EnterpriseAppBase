import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { RegistryError } from '../../../src/core/index';
import { withTemporaryEntries } from '../../../src/core/registry/testing';
import { PERMISSIONS_KEY } from '../../../src/identity/index';
import {
  AboutModule,
  AboutService,
  DeploymentModeService,
  aboutContributorRegistry,
  createAboutController,
  registerAboutContributor,
  type AboutContributorDef,
} from '../../../src/host/index';
import { aboutResponseSchema } from '../../../src/host/about/dto/about-response.dto';

const deployment = new DeploymentModeService({ get: () => 'self-hosted' } as unknown as ConfigService);
const contributor = (id: string, describe: AboutContributorDef['describe'], label = `Label ${id}`): AboutContributorDef => ({ id, label, describe });

describe('AboutService extras (PP-14.13)', () => {
  let service: AboutService;
  const originalPath = process.env.DEPLOY_INFO_PATH;

  beforeEach(() => {
    process.env.DEPLOY_INFO_PATH = '/nonexistent/info.json';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new AboutService({ apiVersion: () => '1.2.3' }, undefined, deployment);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalPath === undefined) delete process.env.DEPLOY_INFO_PATH;
    else process.env.DEPLOY_INFO_PATH = originalPath;
  });

  it('answers exactly as before when no contributor is registered: no extras key at all', async () => {
    expect(aboutContributorRegistry.list()).toEqual([]);
    const report = await service.describe();
    expect(report).not.toHaveProperty('extras');
    expect(aboutResponseSchema.parse(report)).not.toHaveProperty('extras');
  });

  it('serves each contributor as { id, label, facts }, in registration order', async () => {
    await withTemporaryEntries(
      aboutContributorRegistry,
      [
        contributor('transcription', () => ({ provider: 'example-transcribe', regions: 2, beta: true })),
        contributor('flags', async () => ({ enabled: 'a,b' }), 'Feature flags'),
      ],
      async () => {
        const report = await service.describe();
        expect(report.extras).toEqual([
          { id: 'transcription', label: 'Label transcription', facts: { provider: 'example-transcribe', regions: 2, beta: true } },
          { id: 'flags', label: 'Feature flags', facts: { enabled: 'a,b' } },
        ]);
        expect(aboutResponseSchema.parse(report).extras).toHaveLength(2);
      },
    );
  });

  it('leaves a failing or hanging contributor out and keeps the report', async () => {
    await withTemporaryEntries(
      aboutContributorRegistry,
      [
        contributor('throws', () => {
          throw new Error('boom');
        }),
        contributor('rejects', async () => {
          throw new Error('boom');
        }),
        // Cut off at ABOUT_CONTRIBUTOR_TIMEOUT_MS (2 s, real time: the report reads a file first).
        contributor('hangs', () => new Promise(() => undefined)),
        contributor('fine', () => ({ ok: true })),
      ],
      async () => {
        const report = await service.describe();
        expect(report.extras).toEqual([{ id: 'fine', label: 'Label fine', facts: { ok: true } }]);
        expect(report.api.version).toBe('1.2.3');
      },
    );
  }, 10_000);

  it('omits extras when every contributor fails', async () => {
    await withTemporaryEntries(
      aboutContributorRegistry,
      [
        contributor('throws', () => {
          throw new Error('boom');
        }),
      ],
      async () => {
        expect(await service.describe()).not.toHaveProperty('extras');
      },
    );
  });

  it('bounds the facts: credential-looking keys, non-primitives, long strings and key counts', async () => {
    const facts: Record<string, unknown> = {
      region: 'eu',
      apiKey: 'sk-1',
      clientSecret: 's',
      nested: { a: 1 },
      long: 'y'.repeat(900),
      dsn: 'postgres://app:hunter2@db:5432/x',
    };
    for (let i = 0; i < 30; i += 1) facts[`k${i}`] = i;
    await withTemporaryEntries(aboutContributorRegistry, [contributor('bounded', () => facts as never)], async () => {
      const extra = (await service.describe()).extras?.[0].facts as Record<string, unknown>;
      expect(extra.region).toBe('eu');
      for (const dropped of ['apiKey', 'clientSecret', 'nested']) expect(extra).not.toHaveProperty(dropped);
      expect((extra.long as string).length).toBe(200);
      expect(extra.dsn).toBe('postgres://***@db:5432/x');
      expect(Object.keys(extra).length).toBeLessThanOrEqual(16);
    });
  });

  describe('registerAboutContributor', () => {
    it('refuses a bad id, a duplicate, an empty or long label and a missing describe', async () => {
      await withTemporaryEntries(aboutContributorRegistry, [], () => {
        expect(() => registerAboutContributor(contributor('Bad', () => ({})))).toThrow(RegistryError);
        registerAboutContributor(contributor('once', () => ({})));
        expect(() => registerAboutContributor(contributor('once', () => ({})))).toThrow(RegistryError);
        expect(() => registerAboutContributor(contributor('no-label', () => ({}), ' '))).toThrow(/label/);
        expect(() => registerAboutContributor(contributor('long-label', () => ({}), 'x'.repeat(81)))).toThrow(/label/);
        expect(() => registerAboutContributor({ id: 'no-describe', label: 'x' } as never)).toThrow(/describe/);
      });
    });
  });
});

describe('AboutModule access (PP-14.13)', () => {
  const permissionsOf = (controller: { prototype: object }) =>
    Reflect.getMetadata(PERMISSIONS_KEY, (controller.prototype as { getAbout: object }).getAbout) as string[] | undefined;

  it('defaults to system_settings:read through the identity decorators', () => {
    expect(permissionsOf(createAboutController())).toEqual(['system_settings:read']);
  });

  it("takes the app's decorators and permission when it passes them", () => {
    const requirePermissions = jest.fn(() => () => undefined);
    const controller = createAboutController({
      host: { access: { requirePermissions, requireAuthenticated: () => () => undefined } },
      permission: 'about:read',
    });
    expect(requirePermissions).toHaveBeenCalledWith(['about:read']);
    expect(controller.name).toBe('AboutController');
  });

  it('refuses an empty permission and an invalid host at forRoot', () => {
    expect(() => AboutModule.forRoot({ apiVersion: () => '1', permission: ' ' })).toThrow(/permission/);
    expect(() => AboutModule.forRoot({ apiVersion: () => '1', host: {} as never })).toThrow(/definePlatformHost/);
  });
});
