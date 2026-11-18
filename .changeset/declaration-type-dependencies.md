---
"@marinoscar/platform-api": patch
---

The published declarations' type dependencies are declared (#865): `@types/passport`, `@types/passport-jwt`, `@types/passport-google-oauth20` and `@types/pg` are dependencies, so an app compiling with `skipLibCheck: false` no longer fails on the identity and telemetry declarations; `@types/supertest` (beside the optional `supertest`) and `@nestjs/platform-fastify` (the telemetry conformance suite) are optional peers.
