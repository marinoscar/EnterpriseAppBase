import { Module } from '@nestjs/common';

import { DeploymentController } from './deployment.controller';
import { DeploymentService } from './deployment.service';

// =============================================================================
// DeploymentModule (issue #392, epic #388)
// =============================================================================
//
// The admin surface reporting what revision this deployment is running and on
// what machine.
//
// -----------------------------------------------------------------------------
// IT IMPORTS NOTHING, AND THAT IS THE POINT
// -----------------------------------------------------------------------------
//
// No `PrismaModule` (there is no table and no migration — see
// `deployment.service.ts` for why the installer's own file is the source of
// truth), no `SettingsModule` (this is not configuration anybody sets through
// the app), no storage, no queue. The entire dependency surface is `node:fs`,
// `node:os` and `resolveApiVersion()`, which makes this module safe to
// construct in any environment, including one where the database is down —
// useful, since "what is actually deployed here?" is a question most often
// asked mid-incident.
//
// A MODULE OF ITS OWN rather than routes on `HealthModule`, which is the
// tempting neighbour: health endpoints are PUBLIC probes for orchestrators, and
// this one discloses the host's identity, kernel, addresses and deployed
// revision behind `deployment:read`. Putting an Admin-only disclosure surface
// in the module whose defining property is being unauthenticated is how a
// `@Public()` decorator ends up one copy-paste away from the wrong route.
//
// NOTHING IS EXPORTED. `DeploymentService` backs one page and has no second
// consumer; the moment one appears, adding an `exports` line is the diff that
// should be reviewed.
// =============================================================================

@Module({
  controllers: [DeploymentController],
  providers: [DeploymentService],
})
export class DeploymentModule {}
