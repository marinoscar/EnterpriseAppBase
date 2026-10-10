// =============================================================================
// The reference app's NODE_JOB_INPUTS binding (issue #734)
// =============================================================================
//
// Which stored object a node-held job reads, resolved exactly as the data
// plane did before the nodes slice was packaged: the job's organization first
// (`resolveJobOrgId`: payload `orgId`, or the default organization in `single`
// mode), then `resolveStorageObjectInput` on a client scoped to that
// organization (`storage_objects` forces row-level security). The storage
// slice's three named failures become the nodes slice's `NodeJobInputError`,
// which the data plane answers with a 422.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { resolveJobOrgId } from '@marinoscar/platform-api/identity';
import type { Job } from '@marinoscar/platform-api/jobs';
import { NodeJobInputError, type NodeJobInputObject, type NodeJobInputs } from '@marinoscar/platform-api/nodes';

import { PrismaService } from '../../prisma/prisma.service';
import { JobInputResolutionError, resolveStorageObjectInput } from '@marinoscar/platform-api/storage';

/** The reference app's {@link NodeJobInputs}: storage objects, in the job's organization. */
@Injectable()
export class NodeJobInputsAdapter implements NodeJobInputs {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(job: Job): Promise<NodeJobInputObject> {
    const orgId = await resolveJobOrgId(this.prisma, job);
    try {
      return await resolveStorageObjectInput(this.prisma.forOrg(orgId), job);
    } catch (error) {
      if (error instanceof JobInputResolutionError) {
        throw new NodeJobInputError(error.reason, error.message, error.jobId, error.subjectId);
      }
      throw error;
    }
  }
}
