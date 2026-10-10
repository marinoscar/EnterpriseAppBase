// The host ports (issue #696, PP-2.7): how a packaged slice reaches app-owned
// capabilities without importing app code. Recipe: ../README.md, "Host ports".

export { definePlatformHost } from './platform-host';
export type { PlatformAccessPort, PlatformHost } from './platform-host';
export { AUDIT_SINK, PLATFORM_PRISMA, SYSTEM_SETTINGS_STORE } from './ports';
export type {
  AuditEventInput,
  AuditSink,
  PortBinding,
  PrismaClientLike,
  SystemSettingsSnapshot,
  SystemSettingsStore,
} from './ports';
export { PlatformHostModule } from './platform-host.module';
export type { PlatformHostPorts } from './platform-host.module';
