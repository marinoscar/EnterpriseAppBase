import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { composeFragments, type FragmentInput } from '../../src/compose/compose.js';
import { parseBlocks } from '../../src/compose/parse.js';

// The shipped fragments (packages/platform-db/schema): the spec's "Model
// ownership follows slices" table, as data. Adding a model to a slice means
// adding it here, in the same change.
const SCHEMA_DIR = join(__dirname, '..', '..', 'schema');

const OWNERSHIP: Record<string, string[]> = {
  identity: [
    'User', 'UserIdentity', 'Role', 'Permission', 'RolePermission', 'UserRole', 'RefreshToken',
    'PersonalAccessToken', 'DeviceCode', 'AllowedEmail', 'AuditEvent', 'PatDurationUnit', 'DeviceCodeStatus',
    'Organization', 'Membership', 'Invite', 'MembershipStatus', 'InviteStatus', 'RoleScope',
  ],
  settings: ['OrgSettings', 'SystemSettings', 'UserSettings'],
  storage: ['StorageObject', 'StorageObjectChunk', 'StorageObjectStatus'],
  credentials: ['Credential', 'UserCredential', 'OrgCredential'],
  notifications: ['Notification', 'NotificationDelivery', 'PushSubscription', 'NotificationBroadcast', 'NotificationDeliveryStatus', 'NotificationBroadcastStatus'],
  jobs: ['Job', 'JobStatsRollup', 'WorkerNode', 'NodeCredential', 'JobNodeSecret', 'JobStatus', 'JobReason', 'NodeStatus'],
  'db-backup': ['DatabaseBackupRun', 'DatabaseBackupStatus', 'DatabaseBackupTrigger'],
  ai: ['AiModel', 'UserAiKey', 'AiRun', 'AiUsageEvent'],
  sharing: ['Group', 'GroupMember', 'GroupInvite', 'GroupRole', 'Grant', 'GrantGranteeKind'],
};

const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma')).sort();
const inputs: FragmentInput[] = files.map((name) => ({
  origin: 'package',
  name,
  text: readFileSync(join(SCHEMA_DIR, name), 'utf8'),
}));

describe('the shipped platform fragments', () => {
  it('are base.prisma plus one file per slice', () => {
    expect(files).toEqual(['base', ...Object.keys(OWNERSHIP)].map((n) => `${n}.prisma`).sort());
  });

  it.each(Object.entries(OWNERSHIP))('slice %s declares exactly its models and enums', (slice, names) => {
    const { blocks } = parseBlocks(readFileSync(join(SCHEMA_DIR, `${slice}.prisma`), 'utf8'), `${slice}.prisma`);
    const declared = blocks.filter((b) => !b.extend).map((b) => b.name);
    expect(declared.sort()).toEqual([...names].sort());
  });

  it('declare 40 models and 15 enums, each once', () => {
    const all = inputs.flatMap((i) => parseBlocks(i.text, i.name).blocks).filter((b) => !b.extend);
    expect(all.filter((b) => b.kind === 'model')).toHaveLength(40);
    expect(all.filter((b) => b.kind === 'enum')).toHaveLength(15);
    expect(new Set(all.map((b) => b.name)).size).toBe(all.length);
  });

  it('keep generator and datasource in base.prisma only (the app may replace it)', () => {
    for (const i of inputs) {
      const kinds = parseBlocks(i.text, i.name).blocks.map((b) => b.kind);
      const hasBase = kinds.includes('generator') || kinds.includes('datasource');
      expect(hasBase, i.name).toBe(i.name === 'base.prisma');
    }
  });

  it('mark exactly User, Job, StorageObject, Organization and Group as extensible', () => {
    expect(composeFragments(inputs).extensible).toEqual(['Group', 'Job', 'Organization', 'StorageObject', 'User']);
  });

  it('compose on their own with no warning and no rejection', () => {
    expect(composeFragments(inputs).warnings).toEqual([]);
  });

  it('move the 26 User back-relations and Job.backupRun into the slices that own the foreign keys', () => {
    const { extensions } = composeFragments(inputs);
    const by = (m: string): string[] => extensions.filter((e) => e.model === m).map((e) => `${e.from.replace('package:', '').replace('.prisma', '')}:${e.field}`).sort();
    expect(by('User')).toEqual([
      'ai:aiKeys', 'ai:aiModelsUpdated', 'ai:aiRuns', 'ai:aiUsageEvents',
      'credentials:credentialUpdates', 'credentials:orgCredentialUpdates', 'credentials:userCredentials',
      'db-backup:databaseBackupRuns', 'db-backup:databaseRestores',
      'jobs:nodeCredentials', 'jobs:workerNodes',
      'notifications:broadcastsCreated', 'notifications:notificationDeliveries', 'notifications:notifications', 'notifications:pushSubscriptions',
      'settings:orgSettingsUpdates', 'settings:settingsUpdates', 'settings:userSettings',
      'sharing:grantsGiven', 'sharing:grantsReceived', 'sharing:grantsRevoked',
      'sharing:groupInvitesClaimed', 'sharing:groupInvitesSent', 'sharing:groupMembersAdded', 'sharing:groupMemberships', 'sharing:groupsCreated',
      'storage:storageObjects',
    ]);
    expect(by('Job')).toEqual(['db-backup:backupRun']);
    expect(by('StorageObject')).toEqual([]);
    expect(by('Group')).toEqual([]);
    expect(by('Organization').filter((e) => e.startsWith('credentials:'))).toEqual(['credentials:orgCredentials']);
  });

  it('let an app add a back-relation to Group, so an app table can be owned by a group (#728)', () => {
    const app: FragmentInput = {
      origin: 'app',
      name: 'albums.prisma',
      text: [
        'model Album {',
        '  id           String  @id @default(uuid()) @db.Uuid',
        '  ownerGroupId String? @map("owner_group_id") @db.Uuid',
        '  ownerGroup   Group?  @relation(fields: [ownerGroupId], references: [id], onDelete: Restrict)',
        '',
        '  @@map("albums")',
        '}',
        '',
        'extend model Group {',
        '  albums Album[]',
        '}',
        '',
      ].join('\n'),
    };
    const result = composeFragments([...inputs, app]);
    expect(result.extensions.filter((e) => e.model === 'Group').map((e) => e.field)).toEqual(['albums']);
    const group = result.files.get('platform.sharing.prisma')!.split('\nmodel Group {\n')[1]!.split('\n}\n')[0]!;
    expect(group).toMatch(/\n  albums\s+Album\[\]/);
  });

  it('keep the identity-owned User relations in the identity fragment', () => {
    const user = inputs.find((i) => i.name === 'identity.prisma')!.text.split('\nmodel User {\n')[1]!.split('\n}\n')[0]!;
    for (const f of ['identities', 'userRoles', 'auditEvents', 'refreshTokens', 'allowlistEntriesAdded', 'allowlistEntry', 'deviceCodes', 'personalAccessTokens']) {
      expect(user, f).toMatch(new RegExp(`\\n  ${f}\\s`));
    }
    expect(user).not.toMatch(/\n  aiKeys\s/);
  });

  // Invariant: the raw-SQL partial unique indexes exist only in migration SQL.
  // A @@unique here would make Prisma plan to drop and recreate them.
  it('never declare the raw-SQL partial unique indexes and keep the comments that explain them', () => {
    const jobs = inputs.find((i) => i.name === 'jobs.prisma')!.text;
    const backup = inputs.find((i) => i.name === 'db-backup.prisma')!.text;
    expect(jobs).toContain('jobs_active_dedup_uniq_idx');
    expect(backup).toContain('database_backup_runs_active_uniq_idx');
    for (const text of [jobs, backup]) expect(text).not.toMatch(/@@unique\([^)]*(active|dedup)/i);
  });
});
