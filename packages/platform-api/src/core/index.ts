// `@marinoscar/platform-api/core`: framework-free primitives every other slice
// builds on. So far: the typed registry primitive (issue #675, moved here by
// issue #694). Documented in ./README.md.
//
// `registry/index.ts` stays free of Nest so it can load where no container
// exists (seeds, standalone scripts, import-time DTOs); `RegistryFreezeService`
// is the one Nest-aware export and lives in its own file.

export * from './registry/index';
export { RegistryFreezeService } from './registry/registry-freeze.service';

// The host ports (issue #696): the access port (`definePlatformHost`), the
// DI-time ports (`AUDIT_SINK`, `SYSTEM_SETTINGS_STORE`, `PLATFORM_PRISMA`) and
// `PlatformHostModule`, which binds them. Every packaged slice reuses them.
export * from './host/index';
