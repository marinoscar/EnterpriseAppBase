// =============================================================================
// The per-job secret request and response bodies (issue #349, epic #345)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/nodes` since #734 (`schemas.ts`, section
// "From node-job-secret.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  nodeJobSecretRequestSchema,
} from '@marinoscar/platform-contract/nodes';

// The wire schemas live in @marinoscar/platform-contract/nodes since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  nodeJobSecretRequestSchema,
};

export class NodeJobSecretRequestDto extends createZodDto(nodeJobSecretRequestSchema) {}

/** The response to `POST /nodes/:id/jobs/:jobId/secret`. */
export class NodeJobSecretResponseDto {
  @ApiProperty({
    description:
      'What KIND of credential this is — the broker’s own key, e.g. `postgres.readonly`. ' +
      'A node uses it to decide how to interpret `material`; it is not a scope the node ' +
      'requested, it is the one the job’s type declares.',
  })
  kind!: string;

  @ApiProperty({
    description:
      'ISO 8601 timestamp the credential stops working. Bounded by this job’s LEASE — the ' +
      'server does not mint a second clock — so a node that keeps renewing its lease may ask ' +
      'again and get the same grant extended. Once the lease is gone, so is this.',
  })
  expiresAt!: string;

  @ApiProperty({
    description:
      'The credential itself. Its shape is the broker’s business (a DSN, a token and an ' +
      'endpoint, …) and this API passes it through without interpreting it. ⚠ RETURNED ONCE: ' +
      'hold it in memory for the life of this job and nowhere else — do not write it to disk, ' +
      'do not put it in an env var, do not log it, do not pass it to a child process that ' +
      'outlives the job. It is revoked when the job settles.',
    type: Object,
    additionalProperties: true,
  })
  material!: Record<string, unknown>;
}
