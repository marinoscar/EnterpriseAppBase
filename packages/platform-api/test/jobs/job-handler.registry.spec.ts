import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { type Job } from '../../src/jobs/data/jobs-db';
import { z } from 'zod';

import { JobHandler } from '../../src/jobs/job-handler.interface';
import { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import { JobWorker } from '../../src/jobs/job.worker';
import { JobsModule } from '../../src/jobs/jobs.module';
import { JwtAuthGuard } from '../../src/identity/index';
import { JobHistoryPurgeHandler } from '../../src/jobs/handlers/job-history-purge.handler';
import { jobsTestImports } from './support/jobs-test-graph';

// -----------------------------------------------------------------------------
// Test doubles for the three node-eligibility shapes.
//
// The point of these three is that they differ ONLY in which optional members
// they carry — no flag, no configuration, nothing else to set. That is the
// mechanism `serverOnlyTypes()` derives from, and these classes are the whole
// input space of it.
// -----------------------------------------------------------------------------

/** Carries NEITHER optional member: server-only, the default shape. */
class NeitherMemberHandler implements JobHandler {
  readonly type = 'test.neither';

  async process(): Promise<void> {}
}

/** Carries BOTH optional members: node-eligible. */
class BothMembersHandler implements JobHandler {
  readonly type = 'test.both';

  readonly nodeResultSchema = z.object({ ok: z.boolean() });

  async process(): Promise<void> {}

  async persistNodeResult(_job: Job, _result: unknown): Promise<void> {}
}

/** Schema only, no persist function: server-only, not half-eligible. */
class SchemaOnlyHandler implements JobHandler {
  readonly type = 'test.schema-only';

  readonly nodeResultSchema = z.object({ ok: z.boolean() });

  async process(): Promise<void> {}
}

/** Persist function only, no schema: server-only, not half-eligible. */
class PersistOnlyHandler implements JobHandler {
  readonly type = 'test.persist-only';

  async process(): Promise<void> {}

  async persistNodeResult(_job: Job, _result: unknown): Promise<void> {}
}

describe('JobHandlerRegistry', () => {
  let registry: JobHandlerRegistry;

  beforeEach(() => {
    registry = new JobHandlerRegistry();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('register / get / types', () => {
    it('returns the registered handler for its type', () => {
      const handler = new NeitherMemberHandler();
      registry.register(handler);

      expect(registry.get('test.neither')).toBe(handler);
    });

    it('returns undefined for an unregistered type rather than throwing', () => {
      // A `jobs` row can name a type this process does not run — a handler
      // that was removed or renamed. The caller decides what that means.
      expect(registry.get('test.never-registered')).toBeUndefined();
    });

    it('lists every registered type, in registration order', () => {
      registry.register(new NeitherMemberHandler());
      registry.register(new BothMembersHandler());

      expect(registry.types()).toEqual(['test.neither', 'test.both']);
    });

    it('starts empty', () => {
      expect(registry.types()).toEqual([]);
    });
  });

  describe('duplicate registration', () => {
    it('logs a warning and lets the LAST registration win', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const first = new NeitherMemberHandler();
      // A second, distinct class claiming the same `type` string.
      class ShadowingHandler implements JobHandler {
        readonly type = 'test.neither';

        async process(): Promise<void> {}
      }
      const second = new ShadowingHandler();

      registry.register(first);
      registry.register(second);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain('test.neither');
      expect(message).toContain('NeitherMemberHandler');
      expect(message).toContain('ShadowingHandler');

      // Last one wins — the override, not the first registration.
      expect(registry.get('test.neither')).toBe(second);
      // ...and the type is listed once, not twice.
      expect(registry.types()).toEqual(['test.neither']);
    });

    it('does not warn when two different types are registered', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      registry.register(new NeitherMemberHandler());
      registry.register(new BothMembersHandler());

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('serverOnlyTypes', () => {
    it('includes a handler carrying NEITHER optional member', () => {
      registry.register(new NeitherMemberHandler());

      expect(registry.serverOnlyTypes()).toEqual(['test.neither']);
    });

    it('EXCLUDES a handler carrying BOTH optional members', () => {
      registry.register(new BothMembersHandler());

      expect(registry.serverOnlyTypes()).toEqual([]);
      // It is registered — it is just not server-only.
      expect(registry.types()).toEqual(['test.both']);
    });

    it('counts a handler carrying ONLY nodeResultSchema as server-only', () => {
      registry.register(new SchemaOnlyHandler());

      expect(registry.serverOnlyTypes()).toEqual(['test.schema-only']);
    });

    it('counts a handler carrying ONLY persistNodeResult as server-only', () => {
      registry.register(new PersistOnlyHandler());

      expect(registry.serverOnlyTypes()).toEqual(['test.persist-only']);
    });

    it('partitions a mixed registry: everything but the both-members handler', () => {
      registry.register(new NeitherMemberHandler());
      registry.register(new BothMembersHandler());
      registry.register(new SchemaOnlyHandler());
      registry.register(new PersistOnlyHandler());

      expect(registry.serverOnlyTypes().sort()).toEqual(
        ['test.neither', 'test.persist-only', 'test.schema-only'].sort()
      );
    });

    it('is empty for an empty registry', () => {
      expect(registry.serverOnlyTypes()).toEqual([]);
    });
  });
});

// The worked example's own self-registration (`example.echo`) is proven where
// it lives since #734: apps/api/src/examples/jobs/example-echo.handler.spec.ts.
// Here: a handler the slice itself provides registers when
// `JobsModule.forRoot()` boots.
describe('JobHistoryPurgeHandler self-registration (via JobsModule.forRoot)', () => {
  let moduleRef: TestingModule;
  let registry: JobHandlerRegistry;

  beforeEach(async () => {
    // The graph must RESOLVE, not reach a database: this suite never enqueues
    // and never claims, so the database port is an empty stub
    // (`jobsTestImports`). The admin controller's guard is stubbed: nothing
    // here serves a request.
    moduleRef = await Test.createTestingModule({
      imports: [...jobsTestImports(), JobsModule.forRoot()],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      // `JobWorker` (#262) is the one provider in `JobsModule` that RUNS on
      // its own: `init()` below reaches `onApplicationBootstrap` and it would
      // start polling a stubbed Prisma for the life of this suite. Its own
      // lifecycle is proven in `job.worker.bootstrap.spec.ts`; here it would
      // only add noise.
      .overrideProvider(JobWorker)
      .useValue({})
      .compile();

    // `init()` is what runs the `onModuleInit` hooks — the registration path
    // itself. Without it the registry would be empty, which is exactly the
    // race the worker avoids by starting from `onApplicationBootstrap`.
    await moduleRef.init();

    registry = moduleRef.get(JobHandlerRegistry);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('registers itself, so its type appears in types()', () => {
    expect(registry.types()).toContain('job.history.purge');
  });

  it('is retrievable by type and is the module instance', () => {
    expect(registry.get('job.history.purge')).toBe(moduleRef.get(JobHistoryPurgeHandler));
  });

  it('is server-only: it carries neither optional member', () => {
    const handler: JobHandler = moduleRef.get(JobHistoryPurgeHandler);

    expect(handler.nodeResultSchema).toBeUndefined();
    expect(handler.persistNodeResult).toBeUndefined();
    expect(registry.serverOnlyTypes()).toContain('job.history.purge');
  });
});
