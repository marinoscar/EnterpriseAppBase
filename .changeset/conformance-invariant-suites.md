---
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
---

Conformance suites for the remaining invariants. `runPlatformConformance` accepts a suite that registers its own tree (`ConformanceAppSuite`) and an opt-out with a reason (`{ skip: 'reason' }`; an empty reason throws) and prints a summary of suites run and skipped. New suites: `on-event-no-io` (`@marinoscar/platform-api/jobs/testing`) and `ai-kill-switch`, `ai-rbac-matrix`, `ai-secret-egress`, `ai-key-policy`, `ai-jobs-server-only`, `ai-no-sdk-leak` and `ai-orchestration-boundary` (`@marinoscar/platform-api/ai/testing`, with `AiConformanceFixture`). `supertest` becomes an optional peer. `@marinoscar/platform-web/testing` gains `runPlatformWebConformance`, and `@marinoscar/platform-web/settings/testing` registers the settings registry suites.
