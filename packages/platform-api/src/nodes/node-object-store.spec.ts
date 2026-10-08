// =============================================================================
// The NODE_OBJECT_STORE port contract (issue #734), proven with a fake
// =============================================================================
//
// The node data plane needs exactly two storage capabilities: a signed GET
// for a held job's input object and a signed PUT for its output. The port
// grants exactly those (least privilege; the nodes slice imports nothing from
// the storage slice). This spec drives both data-plane calls against a fake
// that records EVERY member access and asserts the plane touches only the two
// methods, with the arguments the port documents. The app's compile-time
// proof that its `StorageProvider` satisfies `NodeObjectStore` lives in
// apps/api/src/platform/jobs/jobs-host.module.ts.
// =============================================================================

import type { ConfigService } from '@nestjs/config';

import { JobHandlerRegistry, type Job, type JobsPrisma } from '../jobs/index';
import { NODE_OUTPUT_KEY_PREFIX, NodeDataPlaneService } from './node-data-plane.service';
import type { NodesService } from './nodes.service';
import type { NodeJobInputs, NodeObjectStore, SignedPutUrlOptions, SignedUrlOptions } from './ports';

const USER = 'user-1';
const NODE_ID = 'node-1';
const JOB_ID = '33333333-3333-4333-8333-333333333333';

/** A fake store that records every member read and every call. */
function recordingStore() {
  const accessed: string[] = [];
  const calls: Array<[string, string, SignedUrlOptions | SignedPutUrlOptions | undefined]> = [];
  const target: NodeObjectStore = {
    async getSignedDownloadUrl(key, options) {
      calls.push(['getSignedDownloadUrl', key, options]);
      return `https://objects.example.test/get/${key}`;
    },
    async getSignedPutUrl(key, options) {
      calls.push(['getSignedPutUrl', key, options]);
      return `https://objects.example.test/put/${key}`;
    },
  };
  const store = new Proxy(target, {
    get(t, property, receiver) {
      accessed.push(String(property));
      return Reflect.get(t, property, receiver);
    },
  });
  return { store, accessed, calls };
}

function makeService(store: NodeObjectStore) {
  const job = {
    id: JOB_ID,
    type: 'example.checksum',
    subjectType: 'storage_object',
    subjectId: 'object-1',
    status: 'running',
    claimedByNodeId: NODE_ID,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  } as Job;
  const nodes = { assertJobHeldByNode: jest.fn().mockResolvedValue(job) } as unknown as NodesService;
  const inputs: NodeJobInputs = {
    resolve: async () => ({ id: 'object-1', name: 'in.bin', size: BigInt(4), mimeType: 'application/octet-stream', storageKey: 'uploads/in.bin' }),
  };
  const config = { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService;
  const registry = new JobHandlerRegistry();
  registry.register({ type: 'example.checksum', process: async () => undefined });
  return new NodeDataPlaneService({} as JobsPrisma, config, nodes, store, registry, inputs);
}

describe('NODE_OBJECT_STORE (the node data plane port)', () => {
  it('signs a GET for the input and a PUT for the output, and touches nothing else on the store', async () => {
    const { store, accessed, calls } = recordingStore();
    const service = makeService(store);

    const download = await service.createDownloadUrl(USER, NODE_ID, JOB_ID, {} as never);
    const upload = await service.createUploadTarget(USER, NODE_ID, JOB_ID, { contentType: 'application/json' } as never);

    expect(new Set(accessed)).toEqual(new Set(['getSignedDownloadUrl', 'getSignedPutUrl']));
    expect(calls.map(([method]) => method)).toEqual(['getSignedDownloadUrl', 'getSignedPutUrl']);

    const [, getKey, getOptions] = calls[0];
    expect(getKey).toBe('uploads/in.bin');
    expect(getOptions).toEqual(expect.objectContaining({ expiresIn: expect.any(Number) }));
    expect(download.url).toBe('https://objects.example.test/get/uploads/in.bin');

    const [, putKey, putOptions] = calls[1];
    expect(putKey.startsWith(`${NODE_OUTPUT_KEY_PREFIX}/${JOB_ID}/`)).toBe(true);
    expect(putOptions).toEqual(expect.objectContaining({ expiresIn: expect.any(Number), contentType: 'application/json' }));
    expect(upload.key).toBe(putKey);
  });

  it('propagates a store failure rather than inventing a URL', async () => {
    const failing: NodeObjectStore = {
      getSignedDownloadUrl: async () => {
        throw new Error('object store unreachable');
      },
      getSignedPutUrl: async () => {
        throw new Error('object store unreachable');
      },
    };
    const service = makeService(failing);

    await expect(service.createDownloadUrl(USER, NODE_ID, JOB_ID, {} as never)).rejects.toThrow('object store unreachable');
    await expect(service.createUploadTarget(USER, NODE_ID, JOB_ID, {} as never)).rejects.toThrow('object store unreachable');
  });

  it('is satisfiable by any object with the two methods (structural, no storage import)', () => {
    const minimal: NodeObjectStore = {
      getSignedDownloadUrl: async (key: string) => key,
      getSignedPutUrl: async (key: string) => key,
    };
    expect(Object.keys(minimal).sort()).toEqual(['getSignedDownloadUrl', 'getSignedPutUrl']);
  });
});
