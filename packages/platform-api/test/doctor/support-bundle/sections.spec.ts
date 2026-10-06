import type { DoctorService } from '../../../src/doctor/doctor.service';
import { DoctorSupportBundleSection } from '../../../src/doctor/support-bundle/sections/doctor.section';
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
});
