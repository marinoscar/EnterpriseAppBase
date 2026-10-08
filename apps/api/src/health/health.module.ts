import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { DbConnectionDoctorCheck } from './doctor/db-connection.doctor-check';
import { DbMigrationsDoctorCheck } from './doctor/db-migrations.doctor-check';
import { EncryptionKeyDoctorCheck } from './doctor/encryption-key.doctor-check';
import { RlsRoleDoctorCheck } from './doctor/rls-role.doctor-check';

@Module({
  // `MaintenanceModeService` (#257) comes from the global host core (#867,
  // `@marinoscar/platform-api/host`): the readiness probe answers the
  // maintenance question BEFORE the database probe.
  imports: [TerminusModule],
  controllers: [HealthController],
  // The `core` doctor checks (#634): database liveness and migrations reuse
  // this module's indicator and Prisma; the encryption-key check has no module
  // of its own to live in (the cipher in `@marinoscar/platform-api/core` is plain functions), and a
  // deployment-health fact belongs beside the other two.
  providers: [
    DatabaseHealthIndicator,
    DbConnectionDoctorCheck,
    DbMigrationsDoctorCheck,
    EncryptionKeyDoctorCheck,
    // `db.rls_role` (#725): the API's database role does not bypass row-level
    // security. A database fact, so it lives with the other two; it moved here
    // from `organizations/` when identity became a package (#727).
    RlsRoleDoctorCheck,
  ],
  // Exported for `AboutModule` (#401, epic #397): `GET /api/admin/about`
  // reports a database liveness fact and must use THIS indicator rather than a
  // second `SELECT 1` of its own, so there stays one definition of "the
  // database answers". The indicator throws `HealthCheckError` on failure,
  // which is right for Terminus and wrong for an about page — `AboutService`
  // catches it and reports `database: null` plus `databaseError`.
  exports: [DatabaseHealthIndicator],
})
export class HealthModule {}
