// The `jobs` and `nodes` system-settings namespaces are the slices' own
// (issue #865): exported as declarations with the shipped policies as their
// defaults, and registered by `JobsModule.forRoot()` / `NodesModule.forRoot()`
// unless the app's manifest already did. Each case loads the package in a
// fresh module registry, so the static namespace registry starts empty.

type SettingsApi = typeof import('../../src/settings/index');
type JobsApi = typeof import('../../src/jobs/index');
type NodesApi = typeof import('../../src/nodes/index');

function fresh<T>(fn: (api: { settings: SettingsApi; jobs: JobsApi; nodes: NodesApi }) => T): T {
  let result: T | undefined;
  jest.isolateModules(() => {
    const settings = require('../../src/settings/index') as SettingsApi;
    const jobs = require('../../src/jobs/index') as JobsApi;
    const nodes = require('../../src/nodes/index') as NodesApi;
    result = fn({ settings, jobs, nodes });
  });
  return result as T;
}

describe('JOBS_SYSTEM_SETTINGS and NODES_SYSTEM_SETTINGS', () => {
  it('ship DEFAULT_JOBS_POLICY and DEFAULT_NODES_POLICY as their defaults, valid against their stored schemas', () => {
    fresh(({ jobs, nodes }) => {
      expect(jobs.JOBS_SYSTEM_SETTINGS.key).toBe('jobs');
      expect(jobs.JOBS_SYSTEM_SETTINGS.defaults).toEqual(jobs.DEFAULT_JOBS_POLICY);
      expect(jobs.JOBS_SYSTEM_SETTINGS.storedSchema.parse(jobs.JOBS_SYSTEM_SETTINGS.defaults)).toEqual(jobs.DEFAULT_JOBS_POLICY);
      expect(nodes.NODES_SYSTEM_SETTINGS.key).toBe('nodes');
      expect(nodes.NODES_SYSTEM_SETTINGS.defaults).toEqual(jobs.DEFAULT_NODES_POLICY);
      expect(nodes.NODES_SYSTEM_SETTINGS.defaults.jobSecretBrokerEnabled).toBe(false);
    });
  });

  it('merge field by field: a named field replaces, an absent one is kept, nothing aliases the stored value', () => {
    fresh(({ jobs, nodes }) => {
      const current = { history: { retentionDays: 30, purgeEnabled: true }, stuckThresholdMinutes: 30 };
      const merged = jobs.mergeJobsSettings(current, { history: { purgeEnabled: false } });
      expect(merged).toEqual({ history: { retentionDays: 30, purgeEnabled: false }, stuckThresholdMinutes: 30 });
      expect(merged.history).not.toBe(current.history);
      expect(jobs.mergeJobsSettings(current, undefined)).toEqual(current);

      const fleet = { ...jobs.DEFAULT_NODES_POLICY };
      expect(nodes.mergeNodesSettings(fleet, { jobSecretBrokerEnabled: true })).toEqual({ ...fleet, jobSecretBrokerEnabled: true });
    });
  });
});

describe('JobsModule.forRoot() and NodesModule.forRoot() register their namespaces', () => {
  it('registers jobs and nodes, in call order, when the app did not', () => {
    fresh(({ settings, jobs, nodes }) => {
      expect(settings.systemSettingsNamespaceRegistry.has('jobs')).toBe(false);
      jobs.JobsModule.forRoot();
      nodes.NodesModule.forRoot();
      expect(settings.systemSettingsNamespaceRegistry.ids()).toEqual(['jobs', 'retention', 'nodes']);
      expect(settings.systemSettingsNamespaceRegistry.get('jobs')).toBe(jobs.JOBS_SYSTEM_SETTINGS);
      // The composed defaults now carry the shipped policies.
      expect(settings.composeDefaultSystemSettings()).toMatchObject({
        jobs: jobs.DEFAULT_JOBS_POLICY,
        nodes: jobs.DEFAULT_NODES_POLICY,
      });
    });
  });

  it('leaves a namespace the app registered itself alone, and a second forRoot() is a no-op', () => {
    fresh(({ settings, jobs, nodes }) => {
      const extended = { ...jobs.JOBS_SYSTEM_SETTINGS, description: 'The app registered its own jobs namespace first.' };
      settings.registerSystemSettingsNamespaces([extended as never]);
      jobs.JobsModule.forRoot();
      jobs.JobsModule.forRoot();
      expect(settings.systemSettingsNamespaceRegistry.get('jobs')).toBe(extended);
      expect(settings.systemSettingsNamespaceRegistry.ids()).toEqual(['jobs', 'retention']);
      void nodes;
    });
  });

  it('refuses, naming the remedy, when SettingsModule.forRoot() already composed the request bodies without it', () => {
    fresh(({ settings, jobs }) => {
      settings.SettingsModule.forRoot();
      expect(() => jobs.JobsModule.forRoot()).toThrow(
        /JobsModule\.forRoot\(\) registers the system settings namespace\(s\) "jobs".*Call JobsModule\.forRoot\(\) before SettingsModule\.forRoot\(\)/s,
      );
    });
  });

  it('is a no-op once the registries are frozen (another application already bootstrapped in this process)', () => {
    fresh(({ settings, nodes }) => {
      settings.systemSettingsNamespaceRegistry.freeze();
      expect(() => nodes.NodesModule.forRoot()).not.toThrow();
      expect(settings.systemSettingsNamespaceRegistry.has('nodes')).toBe(false);
    });
  });
});

describe('ensureSystemSettingsNamespaces', () => {
  it('returns the keys it registered, and nothing on a repeat', () => {
    fresh(({ settings, jobs, nodes }) => {
      const both = [jobs.JOBS_SYSTEM_SETTINGS, nodes.NODES_SYSTEM_SETTINGS] as never[];
      expect(settings.ensureSystemSettingsNamespaces(both, 'test')).toEqual(['jobs', 'nodes']);
      expect(settings.ensureSystemSettingsNamespaces(both, 'test')).toEqual([]);
    });
  });
});
