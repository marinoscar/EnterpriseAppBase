// `@marinoscar/platform-web/ai/headless`: the AI slice's headless web layer
// (issue #739, PP-8.6): the organization AI keys hook and the organization's
// effective AI policy. Documented in ../README.md.

export { useOrgAiKeys } from './use-org-ai-keys.js';
export type { UseOrgAiKeysOptions, UseOrgAiKeysResult } from './use-org-ai-keys.js';
export { useOrgAiPolicy } from './use-org-ai-policy.js';
export type { UseOrgAiPolicyOptions, UseOrgAiPolicyResult } from './use-org-ai-policy.js';
export type { OrgAiKeyView } from '@marinoscar/platform-contract/ai';
