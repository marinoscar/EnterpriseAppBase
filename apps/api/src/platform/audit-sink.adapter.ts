// =============================================================================
// AUDIT_SINK adapter: packaged slices audit into the app's audit_events
// (issue #696, PP-2.7)
// =============================================================================
//
// Same columns every service of the app writes today (`actorUserId`, `action`,
// `targetType`, `targetId`, `meta`), through the same Prisma delegate, so an
// event from a packaged slice is indistinguishable from one the app writes.
// Called after the triggering write commits (the port's contract), outside any
// transaction.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { AuditEventInput, AuditSink } from '@marinoscar/platform-api/core';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaAuditSink implements AuditSink {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        ...(event.meta === undefined ? {} : { meta: event.meta as Prisma.InputJsonValue }),
      },
    });
  }
}
