// =============================================================================
// Node credential delivery: request DTO and Swagger response classes (#1083)
// =============================================================================
//
// The request wraps the contract's schema (`createZodDto`); the responses are
// Swagger classes that `implements` the contract types, so the OpenAPI
// document is built from their decorators.
// =============================================================================

import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  nodeCredentialIssueRequestSchema,
  type NodeCredentialDeliveryState,
  type NodeCredentialIssueResponse,
  type NodeCredentialRevokeAllResponse,
} from '@marinoscar/platform-contract/nodes';

/**
 * The issuance body (`nodeCredentialIssueRequestSchema`): `{ jobId, claimToken? }`.
 *
 * @stability experimental
 */
export class NodeCredentialIssueRequestDto extends createZodDto(nodeCredentialIssueRequestSchema) {}

/**
 * The response of `POST /nodes/:id/credentials/:purpose`.
 *
 * @stability experimental
 */
export class NodeCredentialIssueResponseDto implements NodeCredentialIssueResponse {
  /** The purpose issued. */
  @ApiProperty({ description: 'The purpose issued, e.g. `ai:openai`.' })
  purpose!: string;

  /** The organization the credential was resolved for. */
  @ApiProperty({
    description:
      'The organization the credential was resolved for (the job’s), or `null` for a system job. ' +
      'Key a cache by `(purpose, orgId)`: the same purpose resolves to a different key in a different organization.',
    type: String,
    nullable: true,
  })
  orgId!: string | null;

  /** The credential itself. */
  @ApiProperty({
    description:
      'The credential (`{ apiKey }`, sometimes with non-secret companions such as `baseUrl`). ⚠ This response is the ' +
      'only place it exists on the server side: never logged, never stored. Pin it in memory for the job; cache it only ' +
      'encrypted, and delete it at `expiresAt`.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  material!: Record<string, string>;

  /** Non-secret rotation marker. */
  @ApiProperty({ description: 'Non-secret rotation marker, 16 hex characters; changes when the credential rotates.' })
  version!: string;

  /** Issue time. */
  @ApiProperty({ description: 'ISO 8601 issue time.' })
  issuedAt!: string;

  /** Cache deadline. */
  @ApiProperty({ description: 'ISO 8601 time any cached copy must be deleted by (issue time + `nodes.credentialDelivery.cacheTtlMinutes`).' })
  expiresAt!: string;

  /** The invalidation epoch at issue time. */
  @ApiProperty({ description: 'The deployment’s invalidation epoch at issue time; a cache entry from another epoch is dropped.' })
  epoch!: number;
}

/**
 * The `credentialDelivery` state heartbeat and claim responses carry.
 *
 * @stability experimental
 */
export class NodeCredentialDeliveryStateDto implements NodeCredentialDeliveryState {
  /** Whether delivery is on. */
  @ApiProperty({ description: 'Whether this deployment delivers provider credentials. `false`: wipe every cached credential.' })
  enabled!: boolean;

  /** Invalidation epoch. */
  @ApiProperty({ description: 'Invalidation epoch; when it CHANGES, drop every cached credential.' })
  epoch!: number;

  /** Cache lifetime. */
  @ApiProperty({ description: 'Cache lifetime per entry, in minutes; clamp local expiries to it.' })
  ttlMinutes!: number;

  /** The deliverable purposes. */
  @ApiProperty({ description: 'The allowlisted, registered purposes; drop an entry whose purpose is not listed.', type: [String] })
  purposes!: string[];

  /** System-scope versions. */
  @ApiProperty({
    description:
      'System-scope (`orgId` null) credential versions by purpose; drop a system-scope entry whose version differs. ' +
      'Organization-scoped entries are bounded by their TTL, the epoch and the auth-failure re-acquire.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  versions!: Record<string, string>;
}

/**
 * The response of `POST /admin/nodes/credential-delivery/revoke-all`.
 *
 * @stability experimental
 */
export class NodeCredentialRevokeAllResponseDto implements NodeCredentialRevokeAllResponse {
  /** The epoch now in force. */
  @ApiProperty({ description: 'The epoch now in force; nodes wipe their caches on their next heartbeat.' })
  epoch!: number;
}
