// Internal: the names the AI platform's own code has always used for its
// permission ids (`PERMISSIONS.AI_USE`), bound to the slice's declarations.
// Not exported from the slice: the public name is `AI_PERMISSIONS`
// (./ai.permissions.ts), and the app's own `PERMISSIONS` covers every slice.

import { AI_PERMISSIONS } from './ai.permissions';

export const PERMISSIONS = Object.freeze({
  AI_CONFIG_READ: AI_PERMISSIONS.AI_CONFIG_READ.id,
  AI_CONFIG_WRITE: AI_PERMISSIONS.AI_CONFIG_WRITE.id,
  AI_USE: AI_PERMISSIONS.AI_USE.id,
  ORG_AI_CONFIG_READ: AI_PERMISSIONS.ORG_AI_CONFIG_READ.id,
  ORG_AI_CONFIG_WRITE: AI_PERMISSIONS.ORG_AI_CONFIG_WRITE.id,
} as const);
