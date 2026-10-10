// Compile-time checks of the packaged settings seams (issue #865), built by
// `npm run build` against the installed declarations. Nothing here runs at
// boot: main.ts never imports this file; test/smoke.e2e.mjs loads it to check
// the namespace registration at runtime.
//
// Order matters: the consumer's namespace file first, then slices whose own
// declaration files augment `SystemSettingsNamespaces` (jobs, nodes, storage).

import './notes.settings';

import { JOBS_SYSTEM_SETTINGS, JobsModule } from '@marinoscar/platform-api/jobs';
import { NODES_SYSTEM_SETTINGS } from '@marinoscar/platform-api/nodes';
import { systemSettingsNamespaceRegistry, type SystemSettingsService } from '@marinoscar/platform-api/settings';
import { STORAGE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/storage';

export const PACKAGED_KEYS = [JOBS_SYSTEM_SETTINGS.key, NODES_SYSTEM_SETTINGS.key, STORAGE_SYSTEM_SETTINGS.key];

/** Every key typed: the consumer's (`notes`) and the slices' (`jobs`, `nodes`, `storage`). */
export async function typedReads(settings: SystemSettingsService): Promise<unknown[]> {
  const notes = await settings.getNamespace('notes');
  const jobs = await settings.getNamespace('jobs');
  const nodes = await settings.getNamespace('nodes');
  const storage = await settings.getNamespace('storage');
  const archiveAfterDays: number = notes.archiveAfterDays;
  const purgeEnabled: boolean = jobs.history.purgeEnabled;
  const brokerEnabled: boolean = nodes.jobSecretBrokerEnabled;
  const provider: string = storage.provider;
  // @ts-expect-error a key no augmentation declares (unused, the build fails).
  await settings.getNamespace('neverDeclared');
  return [archiveAfterDays, purgeEnabled, brokerEnabled, provider];
}

/**
 * `JobsModule.forRoot()` registers the `jobs` namespace itself, so a consumer
 * that never declared it still has its policy. Returns the registered keys.
 */
export function registerJobsSlice(): string[] {
  JobsModule.forRoot();
  return systemSettingsNamespaceRegistry.ids();
}
