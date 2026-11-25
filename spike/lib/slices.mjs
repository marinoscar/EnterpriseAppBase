// The spec's "Model ownership follows slices" table (docs/specs/platform-packages.md),
// plus the enums that travel with their owning model. Every one of the 31 base
// models and 10 enums is assigned to exactly one slice.

export const SLICES = [
  'identity',
  'jobs',
  'ai',
  'notifications',
  'storage',
  'db-backup',
  'settings',
  'credentials',
];

const bySlice = {
  identity: [
    'User', 'UserIdentity', 'Role', 'Permission', 'RolePermission', 'UserRole',
    'RefreshToken', 'PersonalAccessToken', 'DeviceCode', 'AllowedEmail', 'AuditEvent',
    // enums
    'PatDurationUnit', 'DeviceCodeStatus',
  ],
  jobs: [
    'Job', 'JobStatsRollup', 'WorkerNode', 'NodeCredential', 'JobNodeSecret',
    'JobStatus', 'JobReason', 'NodeStatus',
  ],
  ai: ['AiModel', 'UserAiKey', 'AiRun', 'AiUsageEvent'],
  notifications: [
    'Notification', 'NotificationDelivery', 'PushSubscription', 'NotificationBroadcast',
    'NotificationDeliveryStatus', 'NotificationBroadcastStatus',
  ],
  storage: ['StorageObject', 'StorageObjectChunk', 'StorageObjectStatus'],
  'db-backup': ['DatabaseBackupRun', 'DatabaseBackupStatus', 'DatabaseBackupTrigger'],
  settings: ['SystemSettings', 'UserSettings'],
  credentials: ['Credential', 'UserCredential'],
};

export const NAME_TO_SLICE = Object.fromEntries(
  Object.entries(bySlice).flatMap(([slice, names]) => names.map((n) => [n, slice])),
);

export function sliceOf(name) {
  const s = NAME_TO_SLICE[name];
  if (!s) throw new Error(`No slice assigned to "${name}"`);
  return s;
}
