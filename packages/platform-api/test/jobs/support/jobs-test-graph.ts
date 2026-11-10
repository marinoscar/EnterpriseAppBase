// The smallest Nest graph `JobsModule.forRoot()` resolves in, without an app
// (#734): configuration from `jobsConfiguration()` alone, the event emitter,
// the Doctor (the jobs checks self-register with it) and a global stub of the
// two app capabilities the queue injects, the database port and the settings
// slice's policy reads.

import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { PLATFORM_PRISMA } from '../../../src/core/index';
import { DoctorModule } from '../../../src/doctor/index';
import { jobsConfiguration } from '../../../src/jobs/jobs.configuration';
import { DEFAULT_JOBS_POLICY, DEFAULT_NODES_POLICY } from '../../../src/jobs/jobs.policy';
import { SystemSettingsService } from '../../../src/settings/index';
import { createTestPlatformHost } from '../../../src/testing/index';

@Global()
@Module({})
class JobsTestHostModule {
  static with(prisma: unknown): DynamicModule {
    const providers = [
      { provide: PLATFORM_PRISMA, useValue: prisma },
      {
        provide: SystemSettingsService,
        useValue: { getJobsPolicy: async () => DEFAULT_JOBS_POLICY, getNodesPolicy: async () => DEFAULT_NODES_POLICY },
      },
    ];
    return { module: JobsTestHostModule, providers, exports: providers.map((p) => p.provide) };
  }
}

/**
 * The imports a spec puts next to `JobsModule.forRoot()`.
 *
 * @param prisma - what `PLATFORM_PRISMA` resolves to; `{}` when the spec never reaches the database.
 * @param env - the environment `jobsConfiguration()` reads; empty (the shipped defaults) by default.
 */
export function jobsTestImports(prisma: unknown = {}, env: NodeJS.ProcessEnv = {}) {
  return [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, load: [() => jobsConfiguration(env)] }),
    EventEmitterModule.forRoot(),
    DoctorModule.forRoot({ host: createTestPlatformHost() }),
    JobsTestHostModule.with(prisma),
  ];
}
