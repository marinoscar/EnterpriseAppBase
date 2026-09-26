import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  AI_KEY_POLICIES,
  AI_MCP_ALLOWED_HOST_PATTERN,
  AI_MCP_ALLOWED_HOSTS_MAX,
  AI_USAGE_RETENTION_MAX_DAYS,
} from '../../../common/schemas/settings.schema';

// =============================================================================
// PUT /api/admin/ai/config — body (issue #428, epic #419)
// =============================================================================
//
// The whole `ai` namespace, in a shape a form can send back unchanged:
// `providers` is keyed by provider id (the admin view lists them as an array
// with more fields; only `enabled` and `baseUrl` are writable).
//
// There is NO key field here and there must never be one. The admin key has
// its own routes (`PUT`/`DELETE /api/admin/ai/providers/:provider/key`) so it
// is verified against the provider before it is stored, and so a settings save
// can never carry, echo or audit it.
// =============================================================================

/** Largest accepted provider id — generous; real ids are short. */
const PROVIDER_ID_MAX = 64;

export const aiProviderSettingsInputSchema = z.object({
  enabled: z.boolean(),
  /**
   * Endpoint override for an OpenAI-compatible gateway. Omit (or send null /
   * empty) for "no override" — which CLEARS a stored override.
   */
  baseUrl: z
    .union([z.url().max(2048), z.literal('')])
    .nullish(),
});

/** `ai.hostedTools` (#442) — every provider-hosted tool type's switch, and the MCP host allowlist. */
export const aiHostedToolsSettingsSchema = z.object({
  web_search: z.boolean(),
  file_search: z.boolean(),
  code_interpreter: z.boolean(),
  image_generation: z.boolean(),
  mcp: z.boolean(),
  /**
   * Hosts an MCP `serverUrl` may name — `mcp.example.com`, or `*.example.com`
   * for its subdomains. Empty: any `https://` host.
   */
  mcpAllowedHosts: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .max(253)
        .regex(AI_MCP_ALLOWED_HOST_PATTERN, 'A hostname, or *.hostname for its subdomains'),
    )
    .max(AI_MCP_ALLOWED_HOSTS_MAX),
});

export const updateAiConfigSchema = z.object({
  enabled: z.boolean(),
  keyPolicy: z.enum(AI_KEY_POLICIES),
  logPromptContent: z.boolean(),
  defaults: z.object({
    /** Omit or null for "no cap" — which CLEARS a stored cap. */
    maxOutputTokensCap: z.number().int().positive().max(1_000_000).nullish(),
    allowBackgroundRuns: z.boolean(),
  }),
  /**
   * Days `ai_usage_events` rows are kept before the daily purge deletes them
   * (#443). Omit to keep the stored value — the one field of this body that is
   * not full-replace, so a client written before it existed still saves.
   */
  usageRetentionDays: z.number().int().min(1).max(AI_USAGE_RETENTION_MAX_DAYS).optional(),
  /**
   * Which provider-hosted tools users may call (#442), all off by default.
   * Omit to keep the stored value, like `usageRetentionDays`, so a client
   * written before it existed still saves.
   */
  hostedTools: aiHostedToolsSettingsSchema.optional(),
  /**
   * Per-provider settings keyed by provider id. A provider left out keeps its
   * stored settings.
   */
  providers: z.record(
    z.string().min(1).max(PROVIDER_ID_MAX),
    aiProviderSettingsInputSchema,
  ),
});

export class UpdateAiConfigDto extends createZodDto(updateAiConfigSchema) {}
export type UpdateAiConfigInput = z.output<typeof updateAiConfigSchema>;
