// The object-processor registry (issue #736): processors self-register from
// `onModuleInit`; `ObjectProcessingService` reads them in priority order.

import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Readable } from 'node:stream';

import type { StorageObject } from '../../../src/storage/data/storage-db';
import { ObjectProcessingService } from '../../../src/storage/processing/object-processing.service';
import type { ObjectProcessor, ObjectProcessorResult } from '../../../src/storage/processing/object-processor.interface';
import { ObjectProcessorRegistry } from '../../../src/storage/processing/object-processor.registry';
import { STORAGE_PROVIDER } from '../../../src/storage/providers/storage-provider.interface';
import { PrismaService } from '../support/app-doubles';
import { createMockPrismaService } from '../support/prisma.mock';
import { createMockStorageProvider } from '../support/storage-provider.mock';

function processor(name: string, priority: number, accepts: (object: StorageObject) => boolean = () => true): ObjectProcessor {
  return {
    name,
    priority,
    canProcess: accepts,
    process: async (): Promise<ObjectProcessorResult> => ({ success: true, metadata: { by: name } }),
  };
}

const object = { id: 'obj-1', orgId: '11111111-1111-4111-8111-111111111111', mimeType: 'image/png', storageKey: 'uploads/x' } as StorageObject;

describe('ObjectProcessorRegistry', () => {
  it('lists processors lowest priority first, ties in registration order', () => {
    const registry = new ObjectProcessorRegistry();
    registry.register(processor('late', 200));
    registry.register(processor('early', 10));
    registry.register(processor('default-a', 100));
    registry.register(processor('default-b', 100));

    expect(registry.names()).toEqual(['early', 'default-a', 'default-b', 'late']);
  });

  it('replaces a processor registered twice under one name (last wins)', () => {
    const registry = new ObjectProcessorRegistry();
    const first = processor('thumb', 100);
    const second = processor('thumb', 50);
    registry.register(first);
    registry.register(second);

    expect(registry.list()).toEqual([second]);
  });

  it('refuses a processor without a name or a finite priority', () => {
    const registry = new ObjectProcessorRegistry();
    expect(() => registry.register(processor(' ', 1))).toThrow(/non-empty name/);
    expect(() => registry.register(processor('x', Number.NaN))).toThrow(/finite priority/);
  });

  it('an app processor registered from onModuleInit is what the processing service runs', async () => {
    @Injectable()
    class AppProcessor implements ObjectProcessor, OnModuleInit {
      readonly name = 'app-processor';
      readonly priority = 100;
      constructor(private readonly registry: ObjectProcessorRegistry) {}
      onModuleInit(): void {
        this.registry.register(this);
      }
      canProcess(candidate: StorageObject): boolean {
        return candidate.mimeType.startsWith('image/');
      }
      async process(_object: StorageObject, getStream: () => Promise<Readable>): Promise<ObjectProcessorResult> {
        await getStream();
        return { success: true, metadata: { seen: true } };
      }
    }

    @Module({ providers: [ObjectProcessorRegistry, AppProcessor], exports: [ObjectProcessorRegistry] })
    class ProcessingTestModule {}

    const prisma = createMockPrismaService();
    prisma.storageObject.findUnique.mockResolvedValue({ metadata: null } as never);
    prisma.storageObject.update.mockResolvedValue({} as never);
    const storage = createMockStorageProvider();

    const moduleRef = await Test.createTestingModule({
      imports: [ProcessingTestModule],
      providers: [
        ObjectProcessingService,
        { provide: PrismaService, useValue: prisma },
        { provide: STORAGE_PROVIDER, useValue: storage },
      ],
    }).compile();
    await moduleRef.init();

    const service = moduleRef.get(ObjectProcessingService);
    expect(moduleRef.get(ObjectProcessorRegistry).names()).toEqual(['app-processor']);
    expect(service.appliesTo(object)).toBe(true);
    expect(service.appliesTo({ ...object, mimeType: 'text/plain' })).toBe(false);

    await expect(service.run(object)).resolves.toBe('ready');
    expect(storage.download).toHaveBeenCalledWith('uploads/x');
    await moduleRef.close();
  });
});
