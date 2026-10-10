import { SupportBundleRegistry } from '../../../src/doctor/index';

import { AboutSupportBundleSection } from '../../../src/host/about/about-support-bundle.section';
import type { AboutService } from '../../../src/host/about/about.service';
import type { AboutResponse } from '../../../src/host/about/dto/about-response.dto';

/** What `describe()` returns when no deploy document exists: partial truth, never an error. */
const NO_DOCUMENT: AboutResponse = {
  api: { version: '1.0.0', deploymentMode: 'self-hosted' },
  deployInfoStatus: 'absent',
  deployInfoPath: '/var/lib/app/deploy/info.json',
  deployInfoError: null,
  app: null,
  installedAt: null,
  updatedAt: null,
  deployedBy: null,
  domain: null,
  remote: null,
  run: null,
  lastCommand: null,
  bindPort: null,
  proxy: null,
  host: null,
  history: null,
  runtime: { processStartedAt: '2026-10-06T00:00:00.000Z', nodeVersion: 'v24.1.0', environment: 'test' },
  database: null,
  databaseError: 'connection refused by db.internal',
};

function setup(report: AboutResponse) {
  const registry = new SupportBundleRegistry();
  const section = new AboutSupportBundleSection(registry, { describe: async () => report } as unknown as AboutService);
  section.onModuleInit();
  return { registry, section };
}

describe('AboutSupportBundleSection (versions)', () => {
  it('registers itself as "versions"', () => {
    const { registry, section } = setup(NO_DOCUMENT);

    expect(registry.get('versions')).toBe(section);
  });

  it('turns a missing deploy document into null fields, not an error, and passes its strict schema', async () => {
    const { section } = setup(NO_DOCUMENT);

    const data = await section.collect();

    expect(section.schema.parse(data)).toEqual({
      api: { version: '1.0.0', deploymentMode: 'self-hosted' },
      app: null,
      deployedBy: null,
      lastCommand: null,
      installedAt: null,
      updatedAt: null,
      deployInfoStatus: 'absent',
      remote: null,
      runtime: { nodeVersion: 'v24.1.0', environment: 'test', processStartedAt: '2026-10-06T00:00:00.000Z' },
      database: null,
      host: null,
      proxy: null,
      history: null,
    });
    expect(JSON.stringify(data)).not.toContain('info.json');
    expect(JSON.stringify(data)).not.toContain('db.internal');
  });

  it('reduces history to its length and its newest entry', async () => {
    const entry = (at: string, sha: string) => ({
      at,
      command: 'update' as const,
      commitSha: sha,
      previousCommitSha: null,
      ref: 'main',
      durationMs: 10,
      cliVersion: '1.0.0',
      outcome: 'success' as const,
    });
    const { section } = setup({
      ...NO_DOCUMENT,
      history: [entry('2026-10-02T00:00:00.000Z', 'b'.repeat(40)), entry('2026-10-01T00:00:00.000Z', 'a'.repeat(40))],
    });

    const data = await section.collect();

    expect(data.history).toEqual({
      count: 2,
      last: { at: '2026-10-02T00:00:00.000Z', command: 'update', commitSha: 'b'.repeat(40), cliVersion: '1.0.0', durationMs: 10 },
    });
  });
});
