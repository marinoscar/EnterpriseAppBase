// =============================================================================
// The data plane's request and response bodies (issue #269, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/nodes` since #734 (`schemas.ts`, section
// "From node-data-plane.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  nodeDownloadUrlSchema,
  nodeUploadUrlSchema,
} from '@marinoscar/platform-contract/nodes';

// The wire schemas live in @marinoscar/platform-contract/nodes since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  nodeDownloadUrlSchema,
  nodeUploadUrlSchema,
};

/**
 * The download-url body (`nodeDownloadUrlSchema`).
 *
 * @stability experimental
 */
export class NodeDownloadUrlDto extends createZodDto(nodeDownloadUrlSchema) {}
/**
 * The upload-url body (`nodeUploadUrlSchema`).
 *
 * @stability experimental
 */
export class NodeUploadUrlDto extends createZodDto(nodeUploadUrlSchema) {}

// =============================================================================
// Responses
// =============================================================================

/**
 * The response to `POST /nodes/:id/jobs/:jobId/download-url`.
 *
 * @stability experimental
 */
export class NodeDownloadUrlResponseDto {
  /** A short-lived signed GET for this job’s input object. */
  @ApiProperty({
    description:
      'A short-lived signed GET for this job’s input object. Fetch it DIRECTLY from the ' +
      'storage provider — the bytes never pass through this API. Treat it as a secret: it ' +
      'is a bearer capability for that one object until it expires, so do not log it, do ' +
      'not write it to disk, and do not pass it to another process.',
  })
  url!: string;

  /** Seconds until the URL stops working. */
  @ApiProperty({
    description:
      'Seconds until the URL stops working. Bounded by the server and not negotiable; ask ' +
      'again if a transfer needs longer, which is cheap while the lease is live.',
  })
  expiresIn!: number;

  /** ISO 8601 timestamp the URL stops working — `expiresIn` as an absolute time. */
  @ApiProperty({
    description: 'ISO 8601 timestamp the URL stops working — `expiresIn` as an absolute time.',
  })
  expiresAt!: string;

  /** The storage object this job names as its input, for correlation in the node’s own logs. */
  @ApiProperty({
    description:
      'The storage object this job names as its input, for correlation in the node’s own logs.',
  })
  objectId!: string;

  /** The object’s recorded size in bytes, as a decimal STRING (the column is a 64-bit integer and JSON has no such number). */
  @ApiProperty({
    description:
      'The object’s recorded size in bytes, as a decimal STRING (the column is a 64-bit ' +
      'integer and JSON has no such number). `"0"` means the size was never recorded — a ' +
      'simple upload leaves it 0 until post-processing — so it is a progress hint, never a ' +
      'contract the node should verify against.',
  })
  size!: string;

  /** The object’s recorded MIME type, for a node that decodes rather than streams. */
  @ApiProperty({
    description: 'The object’s recorded MIME type, for a node that decodes rather than streams.',
  })
  mimeType!: string;
}

/**
 * The response to `POST /nodes/:id/jobs/:jobId/upload-url`.
 *
 * @stability experimental
 */
export class NodeUploadUrlResponseDto {
  /** A short-lived signed PUT accepting ONE request carrying the whole body. */
  @ApiProperty({
    description:
      'A short-lived signed PUT accepting ONE request carrying the whole body. Upload ' +
      'DIRECTLY to the storage provider. If `contentType` was supplied, send exactly that ' +
      '`Content-Type` header or the signature will not match. Treat the URL as a secret.',
  })
  url!: string;

  /** The storage key the server chose for this output. */
  @ApiProperty({
    description:
      'The storage key the server chose for this output. Report it back in the job’s result ' +
      'if the handler needs to record where the bytes went — a node cannot choose this, and ' +
      'sending a `key` in the request is refused with `400`.',
  })
  key!: string;

  /** Seconds until the URL stops working. */
  @ApiProperty({ description: 'Seconds until the URL stops working.' })
  expiresIn!: number;

  /** ISO 8601 timestamp the URL stops working. */
  @ApiProperty({ description: 'ISO 8601 timestamp the URL stops working.' })
  expiresAt!: string;
}

/**
 * One node-eligible job type, with the contract its results must satisfy.
 *
 * @stability experimental
 */
export class NodeJobTypeDto {
  /** The `Job.type` key — what a node registers and claims. */
  @ApiProperty({ description: 'The `Job.type` key — what a node registers and claims.' })
  type!: string;

  /** Display label for the type, falling back to the raw key when none is mapped. */
  @ApiProperty({
    description:
      'Display label for the type, falling back to the raw key when none is mapped.',
  })
  label!: string;

  /** JSON Schema (2020-12) for the `result` this type’s submissions must carry, generated from the server’s own Zod schema — so a client validates against the definition this server will actually... */
  @ApiPropertyOptional({
    description:
      'JSON Schema (2020-12) for the `result` this type’s submissions must carry, generated ' +
      'from the server’s own Zod schema — so a client validates against the definition this ' +
      'server will actually enforce, not a copy. `null` on the rare type whose schema has no ' +
      'JSON Schema representation; validate server-side by submitting in that case.',
    nullable: true,
    type: Object,
  })
  resultSchema!: Record<string, unknown> | null;
}

/**
 * The response to `GET /nodes/job-types`.
 *
 * @stability experimental
 */
export class NodeJobTypesResponseDto {
  /** Every job type this server could accept a node-computed result for — derived from the handler registry, so a fork’s own types appear here with no list to edit. */
  @ApiProperty({
    description:
      'Every job type this server could accept a node-computed result for — derived from the ' +
      'handler registry, so a fork’s own types appear here with no list to edit. A type ' +
      'absent from this list can never be claimed by a node, whatever the node registered.',
    type: [NodeJobTypeDto],
  })
  types!: NodeJobTypeDto[];
}
