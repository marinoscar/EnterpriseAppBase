import { z } from 'zod';

import type { TelemetryAssistantToolDef } from '@marinoscar/platform-api/telemetry';

// =============================================================================
// The reference app's assistant tool: `top_features` (PP-14.18)
// =============================================================================
//
// The worked example of `registerTelemetryAssistantTool`: a tool the telemetry
// assistant offers next to its eight, for a question the built-ins answer only
// by writing SQL: "which parts of the product are used most, and which of them
// fail?". A "feature" here is an API route (`http.route`), the grain this
// reference app's traces carry.
//
// READ-ONLY BY CONTRACT. `run` receives a context, never a client: `ctx.query` is
// the guarded query facade (one read-only statement through the explorer's SQL
// guard, row cap, timeout and audit, source `assistant`), the abort signal and the
// turn's share policy. The tool's output is telemetry data going to the model:
// it is declared `output: 'rows'` (the default) because route names are values the
// monitored system wrote, so while an administrator keeps `assistant.shareResults`
// off the assistant is told the results are hidden and the tool does not run.
//
// NOT REGISTERED BY THE REFERENCE APP. Registering it adds a ninth tool to every
// fork's assistant, so upstream compiles and tests it and a fork opts in with one
// line in `app-registrations/telemetry.ts`:
//
//   registerTelemetryAssistantTool(TOP_FEATURES_TOOL);
//
// (`apps/api/test/examples/telemetry/top-features.assistant-tool.spec.ts`
// registers it into an isolated registry and drives it through the real assistant
// service.)
// =============================================================================

const ROUTE = 'span_attributes.http.route';

/** The tool's arguments, as the model supplies them. */
const inputSchema = z
  .object({
    hours: z.number().int().min(1).max(168).default(24).describe('How far back to look, in hours (1 to 168).'),
    limit: z.number().int().min(1).max(20).default(5).describe('How many features to return (1 to 20).'),
  })
  .strict();

/**
 * `top_features`: the most requested API routes over a window, with how many
 * of those requests failed.
 */
export const TOP_FEATURES_TOOL: TelemetryAssistantToolDef<typeof inputSchema> = {
  name: 'top_features',
  description:
    'The most used features of this application over the last N hours: the API routes (http.route) with the most ' +
    'server requests, each with its error count and error rate. Use it to see which product surfaces carry the ' +
    'traffic before deciding which failures matter.',
  inputSchema,
  async run({ hours, limit }, ctx) {
    const { sql } = ctx.query;
    const since = new Date(Date.now() - hours * 3_600_000);
    const route = sql.ident(ROUTE);
    const result = await ctx.query.query(
      `SELECT ${route} AS feature, count(*) AS requests, ` +
        `sum(CASE WHEN ${sql.ident('span_status_code')} = ${sql.literal('STATUS_CODE_ERROR')} THEN 1 ELSE 0 END) AS errors ` +
        `FROM ${sql.ident('opentelemetry_traces')} ` +
        `WHERE ${sql.ident('span_kind')} = ${sql.literal('SPAN_KIND_SERVER')} AND ${route} IS NOT NULL AND ${route} <> ${sql.literal('')} ` +
        `AND ${sql.ident('timestamp')} >= ${sql.timestamp(since)} ` +
        `GROUP BY feature ORDER BY requests DESC ${ctx.query.dialect.limit(limit)}`,
      { maxRows: limit },
    );

    return {
      windowHours: hours,
      features: result.rows.map(([feature, requests, errors]) => {
        const total = Number(requests);
        const failed = Number(errors);
        return {
          feature: String(feature),
          requests: total,
          errors: failed,
          errorRatePct: total > 0 ? Math.round((failed / total) * 1000) / 10 : 0,
        };
      }),
      truncated: result.truncated,
    };
  },
};
