// =============================================================================
// AiModule boot (issue #424, epic #419)
// =============================================================================
//
// The AI core must boot inside the full application with NO provider
// registered, and on its own with NO database at all — every later AI story
// (catalog, config, keys) layers onto this and must not find a hidden
// dependency underneath.
// =============================================================================

import { Test } from '@nestjs/testing';

import { AiModule } from '../../src/ai/ai.module';
import { AiProviderRegistry } from '../../src/ai/core';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, TestContext } from '../helpers/test-app.helper';

describe('AiModule', () => {
  describe('inside createTestApp()', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await createTestApp();
    });

    afterAll(async () => {
      await ctx?.app.close();
    });

    it('boots with an empty provider registry', () => {
      const registry = ctx.app.get(AiProviderRegistry);

      expect(registry).toBeInstanceOf(AiProviderRegistry);
      expect(registry.ids()).toEqual([]);
    });
  });

  describe('on its own', () => {
    it('compiles with no PrismaService anywhere in the graph', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AiModule] }).compile();
      await moduleRef.init();

      expect(moduleRef.get(AiProviderRegistry).ids()).toEqual([]);
      expect(() => moduleRef.get(PrismaService, { strict: false })).toThrow();

      await moduleRef.close();
    });
  });
});
