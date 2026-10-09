import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.indicator';

@Module({
  // `MaintenanceModeService` (#257) comes from the global host core (#867,
  // `@marinoscar/platform-api/host`): the readiness probe answers the
  // maintenance question BEFORE the database probe.
  imports: [TerminusModule],
  controllers: [HealthController],
  // The `core` doctor checks (`db.connection`, `db.migrations`, `db.rls_role`,
  // `secrets.encryption-key`) are the host slice's (#879), registered by
  // `PlatformHostCoreModule`; this module keeps the readiness probe only.
  providers: [DatabaseHealthIndicator],
  // Exported for `AboutModule` (#401, epic #397): `GET /api/admin/about`
  // reports a database liveness fact and must use THIS indicator rather than a
  // second `SELECT 1` of its own, so there stays one definition of "the
  // database answers". The indicator throws `HealthCheckError` on failure,
  // which is right for Terminus and wrong for an about page — `AboutService`
  // catches it and reports `database: null` plus `databaseError`.
  exports: [DatabaseHealthIndicator],
})
export class HealthModule {}
