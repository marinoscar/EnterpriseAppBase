import { Module } from '@nestjs/common';

/**
 * The provider-agnostic core of the AI platform (issue #424, epic #419).
 *
 * No database access and no provider SDK: everything here is contracts plus
 * the in-memory provider registry, so it boots anywhere — including a
 * `createTestApp()` with nothing registered.
 */
@Module({})
export class AiCoreModule {}
