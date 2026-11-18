// =============================================================================
// The node event log's wire shapes (issue #1045)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/nodes`; these classes add
// the Swagger decorators the generated OpenAPI document is made of, and each
// `implements` its contract type so the two cannot drift.
// =============================================================================

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AdminNodeEvent, AdminNodeEventList } from '@marinoscar/platform-contract/nodes';
import { nodeEventListQuerySchema } from '@marinoscar/platform-contract/nodes';
import { createZodDto } from 'nestjs-zod';

/**
 * The events-list query (`nodeEventListQuerySchema`).
 *
 * @stability experimental
 */
export class NodeEventListQueryDto extends createZodDto(nodeEventListQuerySchema) {}

/**
 * One event a node reported about itself.
 *
 * @stability experimental
 */
export class AdminNodeEventDto implements AdminNodeEvent {
  /** Event ID (UUID) */
  @ApiProperty({ description: 'Event ID (UUID)' })
  id!: string;

  /** The node that reported it (UUID) */
  @ApiProperty({ description: 'The node that reported it (UUID)' })
  nodeId!: string;

  /** Dotted event type */
  @ApiProperty({ description: 'Dotted event type, e.g. `power.battery_low`' })
  type!: string;

  /** How loud it is */
  @ApiProperty({ description: 'How loud it is', enum: ['info', 'warning', 'critical'] })
  severity!: 'info' | 'warning' | 'critical';

  /** The node's scalar attributes, `{}` when none */
  @ApiProperty({
    description: 'The node’s scalar attributes, `{}` when none. Self-reported and untrusted.',
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
  })
  attrs!: Record<string, string | number | boolean>;

  /** When it happened (ISO 8601) */
  @ApiProperty({
    description:
      'When it happened (ISO 8601), on the node’s clock. A value more than 24 hours old or more ' +
      'than 5 minutes ahead of the server is replaced by `receivedAt`.',
  })
  occurredAt!: string;

  /** When the server received it (ISO 8601) */
  @ApiProperty({ description: 'When the server received it (ISO 8601)' })
  receivedAt!: string;
}

/**
 * A page of node events, newest first.
 *
 * @stability experimental
 */
export class AdminNodeEventListDto implements AdminNodeEventList {
  /** The page's events */
  @ApiProperty({ description: 'The page’s events, newest first', type: [AdminNodeEventDto] })
  items!: AdminNodeEventDto[];

  /** Total events matching the filters */
  @ApiProperty({ description: 'Total events matching the filters' })
  total!: number;

  /** Current page, from 1 */
  @ApiProperty({ description: 'Current page, from 1' })
  page!: number;

  /** Page size */
  @ApiProperty({ description: 'Page size' })
  pageSize!: number;

  /** Total pages (at least 1) */
  @ApiProperty({ description: 'Total pages (at least 1)' })
  totalPages!: number;
}

/**
 * Machine-level readings a node reported (`vitals.host`).
 *
 * @stability experimental
 */
export class NodeHostVitalsDto {
  /** System-wide CPU utilisation, 0 to 100 */
  @ApiPropertyOptional({ description: 'System-wide CPU utilisation, 0 to 100', minimum: 0, maximum: 100 })
  cpuPercent?: number;

  /** Logical CPU count */
  @ApiPropertyOptional({ description: 'Logical CPU count' })
  cpuCount?: number;

  /** 1-minute load average */
  @ApiPropertyOptional({ description: '1-minute load average' })
  loadAvg1?: number;

  /** 5-minute load average */
  @ApiPropertyOptional({ description: '5-minute load average' })
  loadAvg5?: number;

  /** 15-minute load average */
  @ApiPropertyOptional({ description: '15-minute load average' })
  loadAvg15?: number;

  /** Total physical memory, bytes */
  @ApiPropertyOptional({ description: 'Total physical memory, bytes' })
  memTotalBytes?: number;

  /** Free physical memory, bytes */
  @ApiPropertyOptional({ description: 'Free physical memory, bytes' })
  memFreeBytes?: number;

  /** Memory available to new work, bytes */
  @ApiPropertyOptional({ description: 'Memory available to new work (reclaimable included), bytes' })
  memAvailableBytes?: number;

  /** OS release string */
  @ApiPropertyOptional({ description: 'The OS release string', maxLength: 128 })
  osRelease?: string;

  /** CPU architecture */
  @ApiPropertyOptional({ description: 'The CPU architecture (`x64`, `arm64`)', maxLength: 32 })
  arch?: string;

  /** Seconds since boot */
  @ApiPropertyOptional({ description: 'Seconds since the machine booted' })
  uptimeSeconds?: number;
}

/**
 * Power state a node reported (`vitals.power`).
 *
 * @stability experimental
 */
export class NodePowerDto {
  /** Where power comes from */
  @ApiProperty({ description: 'Where power comes from', enum: ['ac', 'battery', 'unknown'] })
  source!: 'ac' | 'battery' | 'unknown';

  /** Battery charge, 0 to 100 */
  @ApiPropertyOptional({ description: 'Battery charge, 0 to 100', minimum: 0, maximum: 100 })
  batteryPercent?: number;

  /** Whether the battery is charging */
  @ApiPropertyOptional({ description: 'Whether the battery is charging' })
  charging?: boolean;

  /** Estimated seconds of battery left */
  @ApiPropertyOptional({ description: 'Estimated seconds of battery left' })
  timeRemainingSeconds?: number;

  /** Whether OS low-power mode is on */
  @ApiPropertyOptional({ description: 'Whether the OS low-power / battery-saver mode is on' })
  lowPowerMode?: boolean;
}
