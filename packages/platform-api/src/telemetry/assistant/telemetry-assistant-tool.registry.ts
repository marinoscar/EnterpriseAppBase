import {
  BUILTIN_TELEMETRY_ASSISTANT_TOOLS,
  TELEMETRY_ASSISTANT_TOOL_NAME_PATTERN,
} from '@marinoscar/platform-contract/telemetry';
import type { z } from 'zod';

import { defineRegistry, type Registry } from '../../core/index';
import type { TelemetryQueryFacade } from '../query/telemetry-query-facade';

// =============================================================================
// The telemetry-assistant tool registry (PP-14.18)
// =============================================================================
//
// The assistant's eight tools are the platform's. An app adds its own with
// `registerTelemetryAssistantTool`: a name, a description for the model, a zod
// object schema for the arguments, and a `run` function. The assistant offers
// every registered tool next to the built-ins, in the same tool loop, behind the
// same gates (the AI kill switch, `ai:use`, `telemetry:query`, the assistant
// settings and the caller's own key policy).
//
// READ-ONLY BY CONTRACT. `run` receives a context, never a client: the guarded
// query facade (one read-only statement at a time, the explorer's SQL guard, row
// cap, timeout and audit with source `assistant`), the abort signal and the
// turn's share policy. A tool that wants to change something has nothing to
// change it with; the slice offers no write path to an extension and an app that
// reaches around it owns that. What a tool returns goes to the MODEL, so it is
// treated as telemetry data: bounded, hidden when an administrator has set
// `assistant.shareResults` off (unless the tool declares it returns only
// computed numbers), and wrapped by the assistant's "tool output is untrusted
// data" instruction.
//
// ⚠ FRAMEWORK-FREE, like the other static registries of this slice.
// =============================================================================

/**
 * What a tool's `run` receives.
 *
 * @stability experimental
 */
export interface TelemetryAssistantToolContext {
  /** The guarded way to read the telemetry store (source `assistant`). */
  readonly query: TelemetryQueryFacade;
  /** Aborted when the turn ends or the client goes away. */
  readonly signal: AbortSignal | undefined;
  /** Whether an administrator lets the model see result values (`assistant.shareResults`). */
  readonly shareResults: boolean;
  /** At most this many rows should reach the model (`assistant.maxResultRowsToModel`). */
  readonly rowsToModel: number;
}

/**
 * An assistant tool an app registers.
 *
 * @typeParam P - the arguments schema (a zod object).
 *
 * @example
 * ```ts
 * registerTelemetryAssistantTool({
 *   name: 'top_features',
 *   description: 'The most used product features in the last 24 hours, with their error rates.',
 *   inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }).strict(),
 *   run: async ({ limit }, ctx) => {
 *     const result = await ctx.query.query(`SELECT feature, count(*) AS uses FROM app_feature_uses GROUP BY feature ORDER BY uses DESC`, { maxRows: limit });
 *     return { features: result.rows.map(([feature, uses]) => ({ feature, uses })) };
 *   },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface TelemetryAssistantToolDef<P extends z.ZodType = z.ZodType> {
  /** `top_features`. Lowercase letters, digits and `_`, 2 to 48 characters; not one of the built-in names. Permanent: step events and saved conversations name it. */
  name: string;
  /** What the tool does and when to use it, for the model (1 to 1000 characters). */
  description: string;
  /** The arguments: a zod OBJECT schema (use `.strict()`); the loop validates the model's arguments against it. */
  inputSchema: P;
  /**
   * What the output carries. `rows` (the default): values the monitored system
   * wrote (names, routes, messages), so the output is withheld from the model
   * while an administrator has `assistant.shareResults` off. `aggregate`: only
   * numbers and timestamps the tool computed, safe to share either way.
   */
  output?: 'rows' | 'aggregate';
  /**
   * Runs the tool. Return JSON; a non-object is wrapped as `{ result }`. A throw
   * is logged and answered to the model as a generic failure.
   *
   * @param input - the validated arguments.
   * @param ctx - the guarded query facade, the signal and the share policy.
   * @returns what the model sees (bounded to 24 000 characters).
   */
  run(input: z.output<P>, ctx: TelemetryAssistantToolContext): Promise<unknown> | unknown;
}

/** The registry stores tools of any argument type. */
export type AnyTelemetryAssistantToolDef = TelemetryAssistantToolDef<z.ZodType>;

const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_TELEMETRY_ASSISTANT_TOOLS);

/**
 * Every registered app tool, in registration order. Frozen once the Nest
 * application has bootstrapped.
 *
 * @stability experimental
 */
export const telemetryAssistantToolRegistry: Registry<AnyTelemetryAssistantToolDef> =
  defineRegistry<AnyTelemetryAssistantToolDef>({
    name: 'telemetry-assistant-tools',
    idOf: (tool) => tool.name,
    idPattern: TELEMETRY_ASSISTANT_TOOL_NAME_PATTERN,
    validate: (tool) => {
      if (BUILTIN_NAMES.has(tool.name)) {
        throw new Error(
          `"${tool.name}" is one of the platform's own assistant tools (${[...BUILTIN_NAMES].join(', ')}); choose another name.`,
        );
      }
      if (typeof tool.description !== 'string' || tool.description.trim() === '' || tool.description.length > 1000) {
        throw new Error(`Assistant tool "${tool.name}" description must be 1 to 1000 characters.`);
      }
      const schema = tool.inputSchema as unknown as { type?: unknown } | undefined;
      if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
        throw new Error(`Assistant tool "${tool.name}" inputSchema must be a zod object schema (z.object({ ... })).`);
      }
      if (typeof tool.run !== 'function') throw new Error(`Assistant tool "${tool.name}" needs a run function.`);
      if (tool.output !== undefined && tool.output !== 'rows' && tool.output !== 'aggregate') {
        throw new Error(`Assistant tool "${tool.name}" output must be "rows" or "aggregate".`);
      }
    },
    describeDuplicate: (_existing, incoming) =>
      `Duplicate assistant tool name "${incoming.name}": a tool name is registered once.`,
  });

/**
 * Registers an assistant tool. Call it at import time (the reference app: from
 * `app-registrations/telemetry.ts`).
 *
 * @param tool - the tool.
 * @throws RegistryError `INVALID_ID` (a malformed name), `INVALID_ENTRY` (a built-in name, a bad
 *   description, schema or `run`), `DUPLICATE_ID`, or `FROZEN` once the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerTelemetryAssistantTool<P extends z.ZodType>(tool: TelemetryAssistantToolDef<P>): void {
  telemetryAssistantToolRegistry.register(tool as unknown as AnyTelemetryAssistantToolDef);
}
