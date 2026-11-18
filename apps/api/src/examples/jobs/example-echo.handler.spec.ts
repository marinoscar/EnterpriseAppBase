// =============================================================================
// `example.echo`: the server-only worked example of the handler registry seam
// (moved from the queue's own registry spec with the example, #734)
// =============================================================================

import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';

import { ExampleEchoHandler } from './example-echo.handler';

describe('ExampleEchoHandler', () => {
  let moduleRef: TestingModule;
  let registry: JobHandlerRegistry;

  beforeEach(async () => {
    // The registry is the queue's; the handler is the app's. Providing both in
    // one module is the whole seam: `registry.register(this)` from the
    // handler's own `onModuleInit`.
    moduleRef = await Test.createTestingModule({
      providers: [JobHandlerRegistry, ExampleEchoHandler],
    }).compile();
    await moduleRef.init();
    registry = moduleRef.get(JobHandlerRegistry);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('registers itself, so its type appears in types()', () => {
    expect(registry.types()).toContain('example.echo');
  });

  it('is retrievable by type and is the module instance', () => {
    expect(registry.get('example.echo')).toBe(moduleRef.get(ExampleEchoHandler));
  });

  it('is server-only: it carries neither optional member', () => {
    // Typed as the INTERFACE, not the class: the class does not declare the
    // optional members at all, which is the point — server-only is the
    // absence of them, not a value set to false anywhere.
    const handler: JobHandler = moduleRef.get(ExampleEchoHandler);

    expect(handler.nodeResultSchema).toBeUndefined();
    expect(handler.persistNodeResult).toBeUndefined();
    expect(registry.serverOnlyTypes()).toContain('example.echo');
  });

  it('processes a job without throwing, and logs the payload', async () => {
    const handler = moduleRef.get(ExampleEchoHandler);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const job = {
      id: 'job-1',
      type: 'example.echo',
      reason: 'rerun',
      attempts: 1,
      payload: { hello: 'world' },
    } as unknown as Job;

    await expect(handler.process(job)).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0] as string).toContain('job-1');
    expect(log.mock.calls[0][0] as string).toContain('"hello":"world"');

    log.mockRestore();
  });
});
