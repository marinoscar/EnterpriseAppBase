import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  notificationsResponseSchema,
  jobsResponseSchema,
  nodesResponseSchema,
  databaseBackupResponseSchema,
  maintenanceResponseSchema,
  storageResponseSchema,
  aiResponseSchema,
  retentionResponseSchema,
} from './system-settings-response.schemas';

export const systemSettingsResponseSchema = z.object({
  security: z.object({
    jwtAccessTtlMinutes: z.number(),
    refreshTtlDays: z.number(),
  }),
  notifications: notificationsResponseSchema,
  jobs: jobsResponseSchema,
  nodes: nodesResponseSchema,
  databaseBackup: databaseBackupResponseSchema,
  maintenance: maintenanceResponseSchema,
  storage: storageResponseSchema,
  ai: aiResponseSchema,
  retention: retentionResponseSchema,
  updatedAt: z.iso.datetime(),
  updatedBy: z
    .object({
      id: z.string().uuid(),
      email: z.string().email(),
    })
    .nullable(),
  version: z.number(),
});

export class SystemSettingsResponseDto extends createZodDto(
  systemSettingsResponseSchema,
) {}
