---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-web": minor
---

Add the AI slice: `@marinoscar/platform-api/ai` (`AiModule.forRoot` with the `AI_SYSTEM_PRISMA`, `AI_OBJECT_STORE` and `AI_METRICS` host ports, `AiService.forUser(userId, { orgId, feature })` and the gate pipeline, the OpenAI, Anthropic, Gemini, Azure OpenAI and OpenAI-compatible adapters with their SDKs confined to `ai/providers/`, the model catalogue, the `ai` settings namespaces with a tighten-only org layer, the organization key tier (`/api/admin/ai/org-keys`, `org_ai_config:read`/`write`) and `deploymentKeyServesOrgs`, per-organization daily caps (`limits.perOrg`) and usage (`/api/admin/ai/org-usage`, `groupBy=org`), `registerAiFeature` and `GET /api/ai/features`, `AI_TARGET_RESOLVER`, `UserAiKeysService.importKey`, the `ai-outputs/` key prefix registered with the storage slice, and at `/ai/testing` the fake provider, runtime harness, adapter conformance kit and `runOrchestrationBoundarySuite`), `@marinoscar/platform-contract/ai` (the `ai` namespace schemas, `orgAiSettingsSchema`, `tightenAiPolicy`, the org-key and feature shapes) and `@marinoscar/platform-web/ai` (`useOrgAiKeys`, `useOrgAiPolicy`, `OrgAiKeysPage`).
