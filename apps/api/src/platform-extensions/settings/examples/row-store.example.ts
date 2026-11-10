// =============================================================================
// Reference example: a slice's own system_settings row (#733)
// =============================================================================
//
// Configuration with its own lifecycle (or a secret half) lives in a row of
// its own rather than in a namespace: `email` and `telemetry_connection` are
// this app's. `SystemSettingsRowStore` reads it (defaults while it is
// missing, version 0), validates and audits every write, and keeps a version
// of its own for `If-Match`. The secret half goes to `CredentialsService`;
// the row holds only the non-secret half. (The email and telemetry slices
// still touch their rows directly; each moves to the store with its own
// story, #737 and the telemetry slice.)
// =============================================================================

import { Injectable } from '@nestjs/common';
import { SystemSettingsRowStore } from '@marinoscar/platform-api/settings';
import { z } from 'zod';

const webhookTargetSchema = z.object({
  url: z.string().url().max(2048),
  enabled: z.boolean(),
});

type WebhookTarget = z.infer<typeof webhookTargetSchema>;

const DEFAULTS: WebhookTarget = { url: 'https://hooks.example.test/', enabled: false };

@Injectable()
export class WebhookTargetSettings {
  constructor(private readonly rows: SystemSettingsRowStore) {}

  read() {
    return this.rows.read('webhook_target', webhookTargetSchema, DEFAULTS);
  }

  save(next: WebhookTarget, actorId: string, ifMatch?: number) {
    return this.rows.write('webhook_target', next, { actorId, ifMatch, schema: webhookTargetSchema });
  }
}
