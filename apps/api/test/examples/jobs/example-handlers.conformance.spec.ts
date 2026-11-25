// =============================================================================
// Worked example: the job handler kit and the fake queue over the app's handlers
// (PP-14.26)
// =============================================================================
//
// `describeJobHandlerConformance` is what a handler author writes beside the
// handler. It proves the static contract (a dotted permanent type, a label, a
// profile of exactly two numbers, node eligibility derived from the pair, ai.*
// server-only), then drives the handler through `createFakeJobQueue` over the
// payloads the author supplies: it settles, it is safe to run twice, it fails by
// throwing, duplicates collapse, and `canDelete` is honoured.
//
// Two handlers show the two shapes:
//   - `ExampleEchoHandler`     server-only, no dependencies;
//   - `ExampleChecksumHandler` node-eligible (it carries the pair), over a mocked
//                              database and storage provider, with a handler-declared
//                              idempotency assertion because `computedAt` differs
//                              between runs by design.
//
// The last block is `createFakeJobQueue` in a service test: the service enqueues
// through the `JobsService` surface, the queue collapses the duplicate and runs the
// registered handler.
// =============================================================================

import { Job } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { JobHandlerRegistry, type JobsService } from '@marinoscar/platform-api/jobs';
import { createFakeJobQueue, describeJobHandlerConformance, findJobHandlerContractViolations } from '@marinoscar/platform-api/jobs/testing';
import { STORAGE_OBJECT_SUBJECT_TYPE, type StorageProvider } from '@marinoscar/platform-api/storage';

import { ExampleChecksumHandler, CHECKSUM_METADATA_KEY } from '../../../src/examples/jobs/example-checksum.handler';
import { ExampleEchoHandler } from '../../../src/examples/jobs/example-echo.handler';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { createMockPrismaService, type MockPrismaService } from '../../mocks/prisma.mock';
import { createMockStorageProvider } from '../../mocks/storage-provider.mock';

// ---- a server-only handler -------------------------------------------------------------

describeJobHandlerConformance('example.echo', () => new ExampleEchoHandler(new JobHandlerRegistry()), {
  payloads: [{ name: 'a message', payload: { message: 'hello' }, subjectType: 'greeting', subjectId: 'g1' }],
});

// ---- a node-eligible handler ----------------------------------------------------------------

const OBJECT_ID = 'object-1';
const CONTENT = 'the quick brown fox';

describe('ExampleChecksumHandler under the kit', () => {
  let prisma: MockPrismaService;
  let storage: ReturnType<typeof createMockStorageProvider>;

  const objectRow = (): Record<string, unknown> => ({
    id: OBJECT_ID,
    name: 'fox.txt',
    size: BigInt(CONTENT.length),
    mimeType: 'text/plain',
    storageKey: 'uploads/1/fox.txt',
    storageProvider: 's3',
    bucket: 'test-bucket',
    status: 'ready',
    s3UploadId: null,
    metadata: null,
    uploadedById: 'someone',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  /** What the handler wrote to `metadata.checksum`, per run. */
  const written = (): Array<Record<string, unknown>> =>
    (prisma.storageObject.update as jest.Mock).mock.calls.map((call) => (call[0].data.metadata as Record<string, Record<string, unknown>>)[CHECKSUM_METADATA_KEY]);

  const arrange = (found: boolean): void => {
    prisma = createMockPrismaService();
    storage = createMockStorageProvider();
    (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(found ? objectRow() : null);
    (prisma.storageObject.update as jest.Mock).mockResolvedValue(objectRow());
    storage.download.mockImplementation(async () => Readable.from([Buffer.from(CONTENT)]));
  };

  // The factory runs once per test, after `arrange` of the scenario in use.
  const subject = (): ExampleChecksumHandler =>
    new ExampleChecksumHandler(new JobHandlerRegistry(), prisma as unknown as PrismaService, storage as unknown as StorageProvider);

  describeJobHandlerConformance('example.checksum', subject, {
    payloads: [
      {
        name: 'a stored object',
        subjectType: STORAGE_OBJECT_SUBJECT_TYPE,
        subjectId: OBJECT_ID,
        arrange: () => arrange(true),
        observe: () => written().map(({ computedAt: _computedAt, ...stable }) => stable),
        // Two runs write twice; every field but the timestamp is the same, and it is the same digest.
        assertIdempotent: ({ afterSecond }, expect) => {
          const sha = createHash('sha256').update(CONTENT).digest('hex');
          expect(afterSecond).toEqual([
            { algorithm: 'sha256', sha256: sha, bytes: CONTENT.length, computedBy: 'server' },
            { algorithm: 'sha256', sha256: sha, bytes: CONTENT.length, computedBy: 'server' },
          ]);
        },
      },
      { name: 'an object that is gone', subjectType: STORAGE_OBJECT_SUBJECT_TYPE, subjectId: OBJECT_ID, arrange: () => arrange(false), expectFailure: true },
    ],
  });

  it('carries the pair, so the kit’s derived-eligibility rule has something to prove', () => {
    arrange(true);
    const handler = subject();

    expect(handler.nodeResultSchema).toBeDefined();
    expect(typeof handler.persistNodeResult).toBe('function');
    expect(findJobHandlerContractViolations(handler)).toEqual([]);
  });
});

// ---- the fake queue in a service test ---------------------------------------------------------

/** A service that asks for a report to be built; two requests for the same report are one job. */
class ReportService {
  constructor(private readonly jobs: JobsService) {}

  request(reportId: string): Promise<Job> {
    return this.jobs.enqueue({ type: 'example.echo', reason: 'rerun', subjectType: 'report', subjectId: reportId, payload: { reportId } }) as Promise<Job>;
  }
}

describe('createFakeJobQueue in a service test', () => {
  it('collapses duplicate requests onto one job in flight and runs the registered handler', async () => {
    const queue = createFakeJobQueue();
    queue.register(new ExampleEchoHandler(queue.registry));
    const service = new ReportService(queue.asJobsService());

    const first = await service.request('r1');
    const second = await service.request('r1');
    await service.request('r2');

    expect(second.id).toBe(first.id);
    expect(queue.jobs({ type: 'example.echo' })).toHaveLength(2);

    const runs = await queue.drain();

    expect(runs.map((run) => run.outcome)).toEqual(['succeeded', 'succeeded']);
    expect(queue.jobs({ status: 'succeeded' })).toHaveLength(2);
  });
});
