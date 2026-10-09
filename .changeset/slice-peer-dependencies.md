---
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
"@marinoscar/platform-db": minor
"@marinoscar/platform-cli": minor
"@marinoscar/platform-contract": minor
---

Declare peer dependencies per slice (`packages/platform-slice-peers.json`, checked by `npm run check:slice-peers`) and make every peer that the universal slice does not need optional. `platform-api` now requires only what `core` needs (`@nestjs/common`, `@nestjs/core`, `@nestjs/swagger`, `@opentelemetry/api`, `@prisma/client`, `nestjs-zod`, `reflect-metadata`, `rxjs`, `zod`); `@nestjs/config`, `@nestjs/schedule`, `@nestjs/event-emitter`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `@nestjs/terminus` and `@prisma/client-runtime-utils` become optional peers an app installs for the slices that use them. `platform-web` requires only `@mui/material`, Emotion, `react` and `react-dom`; `@mui/icons-material`, `react-router-dom` and `zod` become optional. `platform-db` no longer lists `@prisma/client` (its seed takes the app's client structurally) and `prisma` becomes optional; `platform-cli`'s `react` becomes optional. An app that installed every peer needs no change; an app that imports only some slices can now install only their peers. The datatable no longer imports the undeclared transitive `@mui/utils`.
