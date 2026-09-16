import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { PERMISSIONS, ROLES } from '../common/constants/roles.constants';
import { DeploymentService } from './deployment.service';
import { DeploymentInfoDto } from './dto/deployment-info.dto';

// =============================================================================
// /api/admin/deployment — what is running here, and where (issue #392, epic #388)
// =============================================================================
//
// One route, one permission, no writes.
//
//   GET /api/admin/deployment    deployment:read
//
// -----------------------------------------------------------------------------
// MOUNTED UNDER `admin/`, WHICH IS A SECURITY BOUNDARY AND NOT A NAMING HABIT
// -----------------------------------------------------------------------------
//
// `JwtAuthGuard` treats path prefixes as part of what a non-session credential
// may reach: a `nod_` worker-node credential can reach `/api/nodes/*` and
// nothing else. A surface that reports the host's hostname, kernel, public IP
// and the exact commit it is running therefore belongs outside that allowlist
// BY CONSTRUCTION rather than by a check somebody has to remember to write —
// the same argument `db-backup.controller.ts` and `nodes-admin.controller.ts`
// each make about their own prefixes.
//
// -----------------------------------------------------------------------------
// ⚠ IT ANSWERS 200 WHEN THERE IS NOTHING TO REPORT
// -----------------------------------------------------------------------------
//
// No deployment record is the ORDINARY case: every developer machine, every CI
// run and every `docker compose up` that was not driven by `appctl deploy` has
// no state file. A 404 would make "this is a laptop" indistinguishable from
// "this endpoint is broken", and would put an error in the console on every
// load of a healthy page. `configured: false` plus a `source.reason` is the
// answer instead — the same posture `GET /api/admin/db-backup/node-credential-
// preflight` takes for a missing capability and `POST /api/admin/storage-config
// /bucket` takes for a credential that may not create buckets: the STATUS CODE
// IS NOT THE ANSWER, the BODY is.
//
// -----------------------------------------------------------------------------
// THERE IS NO SECOND ROUTE, AND NO WRITE
// -----------------------------------------------------------------------------
//
// Nothing in this application writes the deployment record. `appctl deploy`
// does, on the VPS, before this process exists. Adding a write here would mean
// the API asserting facts about a host it cannot observe — see
// `deployment.service.ts` — so `deployment:read` has no `:write` counterpart
// and should not acquire one.
// =============================================================================

@ApiTags('Deployment')
@Controller('admin/deployment')
export class DeploymentController {
  constructor(private readonly deployment: DeploymentService) {}

  @Get()
  @Auth({ roles: [ROLES.ADMIN], permissions: [PERMISSIONS.DEPLOYMENT_READ] })
  @ApiOperation({
    summary: 'What is deployed here, and on what (Admin only)',
    description:
      'Reports the deployment record `appctl deploy` wrote on this server — the repository ' +
      'and commit now serving requests, when it was installed and last updated, the host it ' +
      'runs on, the proxy in front of it and the recent deployment history — together with ' +
      'live facts this container can answer for itself.\n\n' +
      '**This returns HTTP 200 even when no deployment has been recorded.** A missing state ' +
      'file is the ordinary case for every environment not installed by `appctl` (local ' +
      'development, CI, a plain `docker compose up`), not a fault — read `configured`. A ' +
      'client that branches on the status code, or that reads `deployment` without checking ' +
      '`configured`, breaks on every developer machine in the project.\n\n' +
      '`runtime` is **always** present, including when `configured` is false: the API ' +
      'version, this process’s start time, its Node version and `hostname` — which ' +
      'is the **container’s** hostname (on Docker, the container id), **not** the ' +
      'server’s. The machine’s own hostname is `deployment.host.hostname`; the two ' +
      'name different machines in the same response, and which is which is given by ' +
      'the object each sits in.\n\n' +
      '`source.reason` says why there is no record, because the three causes need different ' +
      'fixes: `not-found` (nothing to read — usually correct), `unreadable` (the path exists ' +
      'but cannot be read: a permission problem, or a bind mount that produced a directory) ' +
      'and `invalid` (bytes were read and are not a deployment record).\n\n' +
      'A `version: 1` record is served without the `host`, `proxy` and `history` sections, ' +
      'which v2 added; their absence means the deployment predates them, not that the ' +
      'information is unavailable.',
  })
  @ApiResponse({
    status: 200,
    description:
      'The deployment record and this process’s runtime facts. Check `configured`; ' +
      '`false` is a normal answer, not an error.',
    type: DeploymentInfoDto,
  })
  async getDeployment(): Promise<DeploymentInfoDto> {
    return this.deployment.describe();
  }
}
