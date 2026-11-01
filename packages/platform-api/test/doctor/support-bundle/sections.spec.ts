import type { DoctorService } from '../../../src/doctor/doctor.service';
import { DoctorSupportBundleSection } from '../../../src/doctor/support-bundle/sections/doctor.section';
import { EgressRegistry } from '../../../src/doctor/egress/egress.registry';
import { egressDependency } from '../../../src/doctor/egress/classify-host';
import { EgressSupportBundleSection } from '../../../src/doctor/support-bundle/sections/egress.section';
import { MetaSupportBundleSection, PLATFORM_PACKAGE_NAMES } from '../../../src/doctor/support-bundle/sections/meta.section';
import { SupportBundleRegistry } from '../../../src/doctor/support-bundle/support-bundle.registry';

const REPORT = {
  verdict: 'warn' as const,
  generatedAt: '2026-10-06T00:00:00.000Z',
  durationMs: 12,
  checks: [
    {
      id: 'core.database',
      category: 'core',
      label: 'Database',
      settingsPath: null,
      status: 'warn' as const,
      detail: 'slow',
      remedy: 'Look at it.',
      error: null,
      data: { latencyMs: 900 },
      durationMs: 12,
    },
  ],
};

describe('built-in support-bundle sections', () => {
  describe('doctor', () => {
    it('serves the cached report (refresh: false) unchanged, and it fits its strict schema', async () => {
      const run = jest.fn().mockResolvedValue(REPORT);
      const registry = new SupportBundleRegistry();
      const section = new DoctorSupportBundleSection(registry, { run } as unknown as DoctorService);
      section.onModuleInit();

      const data = await section.collect();

      expect(run).toHaveBeenCalledWith({ refresh: false });
      expect(section.schema.parse(data)).toEqual(REPORT);
      expect(registry.list()).toEqual([section]);
    });

    it('refuses a report row with a field the schema does not know', () => {
      const registry = new SupportBundleRegistry();
      const section = new DoctorSupportBundleSection(registry, {} as DoctorService);
      const extra = { ...REPORT, checks: [{ ...REPORT.checks[0], secretValue: 'x' }] };

      expect(section.schema.safeParse(extra).success).toBe(false);
    });
  });

  describe('meta', () => {
    it('reports the installed platform packages and every registered section id, nothing else', async () => {
      const registry = new SupportBundleRegistry();
      const section = new MetaSupportBundleSection(registry);
      section.onModuleInit();
      registry.register({ id: 'versions', label: 'Versions', schema: section.schema, collect: async () => ({}) } as never);

      const data = await section.collect();

      expect(Object.keys(data).sort()).toEqual(['platformPackages', 'sections']);
      expect(data.sections).toEqual(['meta', 'versions']);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      expect(data.platformPackages['@marinoscar/platform-api']).toBe(require('../../../package.json').version);
      for (const name of Object.keys(data.platformPackages)) expect(PLATFORM_PACKAGE_NAMES).toContain(name);
      expect(section.schema.parse(data)).toEqual(data);
    });
  });

  describe('egress', () => {
    function setup(network?: 'online' | 'air-gapped') {
      const egress = new EgressRegistry();
      egress.register({
        id: 'storage',
        describe: async () => [
          egressDependency({
            id: 'storage.s3',
            capability: 'Object storage',
            direction: 'server',
            enabled: true,
            hosts: ['https://ops:secret@s3.eu-west-1.amazonaws.com/bucket/key?X-Amz-Signature=abc'],
            required: true,
            degradation: 'Uploads stop',
            settingsPath: '/admin/settings/storage',
          }),
        ],
      });
      egress.register({
        id: 'broken',
        describe: async () => {
          throw new Error('boom');
        },
      });
      const registry = new SupportBundleRegistry();
      const section = new EgressSupportBundleSection(registry, egress, network ? { network } : undefined);
      section.onModuleInit();
      return { registry, section };
    }

    it('lists hosts and scopes only, never a URL, and fits its strict schema', async () => {
      const { registry, section } = setup('air-gapped');

      const data = await section.collect();

      expect(registry.get('egress')).toBe(section);
      expect(section.schema.parse(data)).toEqual(data);
      expect(data.network).toBe('air-gapped');
      expect(data.dependencies[0]).toEqual({
        id: 'storage.s3',
        capability: 'Object storage',
        direction: 'server',
        enabled: true,
        hosts: ['s3.eu-west-1.amazonaws.com'],
        scope: 'public',
        required: true,
        degradation: 'Uploads stop',
        settingsPath: '/admin/settings/storage',
        count: null,
      });
      expect(JSON.stringify(data)).not.toMatch(/secret|bucket\/key|X-Amz|https:/);
    });

    it('turns a throwing contributor into one unknown entry, and assumes online without a source', async () => {
      const { section } = setup();

      const data = await section.collect();

      expect(data.network).toBe('online');
      expect(data.dependencies.find((d) => d.id === 'broken')).toMatchObject({ scope: 'unknown', hosts: [] });
    });
  });
});
