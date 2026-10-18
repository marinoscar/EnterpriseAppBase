// Moved to `@marinoscar/platform-ai-providers` (#991) so the AI provider
// adapters and their core types run without Nest. This path re-exports the
// names it always exported, unchanged, so platform imports keep working.
// The side-effect import runs the `AiError` integration (ai-error.ts) first.

import './ai-error';

export {
  AI_MCP_MAX_HEADERS,
  AI_MCP_SERVER_LABEL,
  AI_REDACTED,
  aiHostedToolSchema,
  aiStoredHostedToolSchema,
  assertHostedToolsAllowed,
  assertHostedToolShapes,
  hasMcpHeaders,
  hostedToolsOf,
  isMcpHostAllowed,
  mcpHeaderValues,
  mcpHost,
  redactSecretValues,
} from '@marinoscar/platform-ai-providers';

export type {
  AiHostedToolsPolicy,
} from '@marinoscar/platform-ai-providers';
