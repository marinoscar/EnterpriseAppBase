---
"@marinoscar/platform-api": minor
---

Move the health probes (`GET /api/health`, `/live`, `/ready`, with `DatabaseHealthIndicator` reading through `PLATFORM_PRISMA`) and `buildCorsOptions` / `isSameOriginOnly` into `@marinoscar/platform-api/host` (#901). `PlatformHostCoreModule.forRoot()` now mounts the health controller; `@nestjs/terminus` is a new peer dependency. Routes, responses and the OpenAPI document are unchanged.
