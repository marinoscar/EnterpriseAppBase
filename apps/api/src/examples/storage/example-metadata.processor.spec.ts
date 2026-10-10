// The reference example of the object-processor registry (issue #736): the
// app's processor registers itself from `onModuleInit`, an upload of its media
// type needs processing (any other is ready at once), and the processing run
// executes it and records its metadata on the row.

import { Readable } from 'node:stream';

import { Test } from '@nestjs/testing';
import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import {
  ObjectProcessingService,
  ObjectProcessorRegistry,
  STORAGE_PROVIDER,
  type StorageObject,
} from '@marinoscar/platform-api/storage';

import { EXAMPLE_METADATA_MIME_TYPE, ExampleMetadataProcessor } from './example-metadata.processor';

const ORG = '11111111-1111-4111-8111-111111111111';

function object(mimeType: string): StorageObject {
  return {
    id: 'obj-1',
    name: 'sample.bin',
    size: BigInt(4),
    mimeType,
    storageKey: `uploads/${ORG}/1/obj-1.bin`,
    storageProvider: 's3',
    bucket: 'b',
    status: 'processing',
    s3UploadId: null,
    metadata: null,
    uploadedById: 'user-1',
    orgId: ORG,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe('ExampleMetadataProcessor through the processor registry', () => {
  it('registers itself, applies to its media type only, and its run lands on the row', async () => {
    const update = jest.fn().mockResolvedValue({});
    const scoped = {
      storageObject: { findUnique: jest.fn().mockResolvedValue({ metadata: null }), update, updateMany: jest.fn() },
    };
    const prisma = { forOrg: () => scoped };
    const storage = { download: jest.fn(async () => Readable.from([Buffer.from([0xde, 0xad, 0xbe, 0xef])])) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ObjectProcessorRegistry,
        ObjectProcessingService,
        ExampleMetadataProcessor,
        { provide: PLATFORM_PRISMA, useValue: prisma },
        { provide: STORAGE_PROVIDER, useValue: storage },
      ],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(ObjectProcessorRegistry).names()).toEqual(['example-metadata']);

    const processing = moduleRef.get(ObjectProcessingService);
    expect(processing.appliesTo(object(EXAMPLE_METADATA_MIME_TYPE))).toBe(true);
    expect(processing.appliesTo(object('application/pdf'))).toBe(false);

    await expect(processing.run(object(EXAMPLE_METADATA_MIME_TYPE))).resolves.toBe('ready');
    expect(storage.download).toHaveBeenCalledWith(`uploads/${ORG}/1/obj-1.bin`);
    const written = update.mock.calls[0][0].data;
    expect(written.status).toBe('ready');
    expect(written.metadata._processing['example-metadata']).toMatchObject({ objectId: 'obj-1', firstBytes: 'de ad be ef' });

    await moduleRef.close();
  });
});
