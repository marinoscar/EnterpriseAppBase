import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { NOTIFICATION_EVENTS } from './support/notifications';

// =============================================================================
// The four operational events add NO SCHEMA (issue #288, epic #254)
// =============================================================================
//
// #288 is the issue that proves epic #109's central promise on a new axis:
// ADDING A NOTIFICATION COSTS ONE REGISTRY ENTRY, a template and a call site —
// no table, no column, no migration, no endpoint.
//
// That is not a nice-to-have. `notification_deliveries`, `notifications` and
// the sparse `user_settings.notifications` blob are DELIBERATELY keyed by an
// opaque event-key STRING rather than by a foreign key into an events table, so
// a new event is data and not DDL. A migration filed for these four would mean
// somebody had reached for a per-event table or a per-event column, and the very
// next event would need one too.
//
// The guard is a pinned list rather than a count, so the failure message names
// the migration that was added rather than saying "expected 11, got 12".
// =============================================================================

/**
 * Every migration in the repository at the time #288 landed.
 *
 * ⚠ ADDING TO THIS LIST IS FINE — later issues legitimately add migrations, and
 * this list is expected to grow. What it must never do is grow FOR THESE FOUR
 * EVENTS. If you are extending it, the question to answer in review is "what
 * schema does my change need, and is it about notifications?".
 */
const MIGRATIONS_AT_288 = [
  '20260124223146_initial',
  '20260329151231_add_personal_access_tokens',
  '20260830211041_add_credentials',
  '20260831010356_add_notification_deliveries',
  '20260831014110_drop_stale_uuid_defaults',
  '20260831030721_add_notifications',
  '20260905182958_add_push_subscriptions',
  '20260906120000_add_jobs',
  '20260906190000_add_worker_nodes',
  '20260907120000_add_database_backup_runs',
  '20260907130000_add_notification_broadcasts',
  '20260907140000_add_backup_run_job_link',
  // #349 (epic #345): the per-job secret broker's handle ledger. A schema
  // change, and deliberately not one about notifications — see the ⚠ above.
  '20260907150000_add_job_node_secrets',
  // #352 (epic #345): `database_backup_runs.pg_dump_version` — which client
  // wrote the archive, which only matters once a machine this API cannot
  // inspect can be the one that wrote it. Also not about notifications.
  '20260907160000_add_backup_run_pg_dump_version',
  // #361: `jobs.claim_token` — per-claim identity, so two API replicas holding
  // the same job at different times can be told apart. A schema change, and
  // about the queue's lease ownership rather than about notifications.
  '20260908120000_add_job_claim_token',
  // #423 (epic #419, umbrella #418): the AI platform's four tables
  // (ai_models, user_ai_keys, ai_runs, ai_usage_events). A schema change, and
  // not about notifications — see the ⚠ above.
  '20260926034919_add_ai_platform',
  // #499: a DATA-ONLY migration revoking the `viewer`/`ai:use` role_permissions
  // row on existing deployments. No schema change and not about notifications
  // — see the ⚠ above.
  '20260927000000_revoke_viewer_ai_use',
  // #387: `user_credentials` — the per-user (owner-bound) sibling of the
  // `credentials` store. A schema change about secrets, not notifications.
  '20260927120000_add_user_credentials',
  // #518: links a device-authorization session to the credential it issued
  // (device_codes.pat_id/collected_at/credential_expires_at/revoked_at,
  // refresh_tokens.device_code_id). About device auth, not notifications.
  '20260927130000_add_device_session_credential_link',
  // #604: `worker_nodes.last_vitals`/`last_vitals_at` — a node's heartbeat
  // health snapshot. About the worker fleet, not notifications.
  '20260928100000_add_worker_node_vitals',
  // #607: `jobs.trace_context` — the enqueuing request's W3C traceparent.
  // About job tracing, not notifications.
  '20260930120000_add_job_trace_context',
  // #681: plain `created_at` indexes for the retention sweeps. About data
  // retention, not the operational notification events.
  '20261006120000_add_retention_created_at_indexes',
  // #721 (PP-6.1): organizations, memberships and invites, the nullable
  // `org_id` on the credential tables and the default-org backfill. About
  // tenancy, not the operational notification events.
  '20261007141244_add_organizations',
  // #723 (PP-6.3): role and permission scopes, the membership and invite org
  // role, and the move of org-role assignments onto memberships. About RBAC,
  // not the operational notification events.
  '20261007161956_split_system_org_roles',
  // #725 (PP-6.5): org_id on the tenant tables and row-level security. About
  // tenant isolation, not the operational notification events.
  '20261007202337_org_scoped_rls',
  // #728 (PP-7.1): groups, group members and group invites with row-level
  // security. About sharing, not the operational notification events.
  '20261007222406_add_groups',
  // #729 (PP-7.2): grants with row-level security and partial unique indexes.
  // About sharing, not the operational notification events.
  '20261008000859_add_grants',
  '20261008012052_add_org_settings',
  '20261008041856_add_org_credentials',
  // #734 (PP-8.2): org_id on jobs and its (org_id, status) index. About job
  // tenancy, not the operational notification events.
  '20261008052119_add_jobs_org_id',
  '20261008052120_add_jobs_org_id_status_index',
  // #738: broadcasts gain a target organization (a column on
  // notification_broadcasts; the four operational events still need nothing).
  '20261008080749_add_broadcast_target_org',
];

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');

function migrationDirectories(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('#288 adds no migration', () => {
  it('the migrations directory is unchanged by this issue', () => {
    expect(migrationDirectories()).toEqual([...MIGRATIONS_AT_288].sort());
  });

  it('no migration mentions any of the four event keys', () => {
    // The other shape this failure takes: a migration that seeds the events
    // into a table, which would make the registry a cache of the database
    // rather than the source of truth `notification-events.ts` says it is.
    const names = migrationDirectories().join(' ');

    for (const fragment of ['job_failed', 'node_offline', 'backup_failed', 'restore_completed']) {
      expect(names).not.toContain(fragment);
    }
  });

  it('the four events are declared in code, which is the whole point', () => {
    // The positive half: they exist, and they exist in the registry file.
    const keys = NOTIFICATION_EVENTS.map((event) => event.key);

    expect(keys).toEqual(
      expect.arrayContaining([
        'jobs.job_failed',
        'nodes.node_offline',
        'db_backup.backup_failed',
        'db_backup.restore_completed',
      ]),
    );
  });
});
