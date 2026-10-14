// =============================================================================
// POST /nodes/:id/telemetry — the node span relay's body (issue #608)
// =============================================================================
//
// A worker node records a handful of PHASE spans per job (download, execute,
// upload, submit, secret) and hands them to this server, which re-emits them
// through its own OpenTelemetry pipeline as children of the job's enqueuing
// span (`jobs.trace_context`, #607). A node never talks to the collector: it
// has no collector address, no exporter credential, and no business holding
// either.
//
// EVERY FIELD HERE IS UNTRUSTED, BOUNDED AND ALLOWLISTED — the argument
// `node-control-plane.dto.ts` makes in its header applies unchanged, and one
// step harder, because what arrives here does not just land in a row: it is
// WRITTEN INTO THE DEPLOYMENT'S TRACE STORE, where an operator reads it as
// fact. So:
//
//   - `.strict()` at the request and the span. An unknown key is a refusal,
//     never a silently forwarded attribute.
//   - `name` is one of the five phases the CLI records, or an EXECUTOR'S OWN
//     span under the fixed prefix `job.app.` and a short lower-case name
//     (`job.app.transcode`). The prefix is the control: an app span can never
//     collide with a built-in phase, and the trace store's name cardinality is
//     bounded by the executors a deployment installs plus the per-node rate
//     limit, not by what a node chooses to send. Anything else is refused.
//   - A refused SPAN is dropped on its own and counted in `dropped`; it does not
//     fail the batch. (A body that is not `{ spans: [...] }`, or that carries
//     more than the cap, is still a 400.) One executor's malformed span must not
//     cost a node the rest of a legitimate batch.
//   - `errorType` is a short, identifier-shaped CLASS or CODE
//     (`MissingJobInputError`, `ApiError.409`), never a message. Error
//     messages carry paths, hostnames, URLs — the signed URLs of the data
//     plane among them — and nothing here may carry one.
//   - `attributes` is an ALLOWLIST (`node-span-attribute.registry.ts`): the
//     platform's four integers plus whatever the app registered with
//     `registerNodeSpanAttribute`, each an integer or a short token-shaped
//     string (no space, slash, colon or quote), at most 16 keys a span. The wire
//     shape is open only in the key; what is emitted is decided against the
//     registry when the span is relayed, and an unregistered key is dropped
//     from the span.
//   - Times are bounded on both ends: no span older than a day, none that
//     ends more than a few minutes in the future (clock skew), none longer
//     than a day. A span outside that window is not a clock problem worth
//     tolerating, it is garbage that would distort every latency chart.
//
// WHAT IS DELIBERATELY *NOT* HERE: `nodeId`, `traceId`, `spanId`, a parent.
// Identity comes from the PATH, after ownership is proven; the parent comes
// from the job row the server already holds. A node that could name its own
// trace could graft spans onto any trace it had ever seen an id for.
// =============================================================================

import { ApiProperty } from '@nestjs/swagger';
import { BUILTIN_NODE_SPAN_NAMES, NODE_APP_SPAN_NAME_PATTERN } from '@marinoscar/platform-contract/nodes';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  MAX_NODE_SPAN_ATTRIBUTES,
  MAX_NODE_SPAN_ATTRIBUTE_STRING_LENGTH,
  NODE_SPAN_ATTRIBUTE_KEY_PATTERN,
  NODE_SPAN_ATTRIBUTE_STRING_PATTERN,
} from '../node-span-attribute.registry';

/**
 * The phase spans a node always relays. Adding one is an API change, on purpose.
 *
 * @stability experimental
 */
export const NODE_SPAN_NAMES = BUILTIN_NODE_SPAN_NAMES;

export { NODE_APP_SPAN_NAME_PATTERN };

/**
 * A built-in phase span name.
 *
 * @stability experimental
 */
export type BuiltinNodeSpanName = 'job.download' | 'job.execute' | 'job.upload' | 'job.submit' | 'job.secret';

/**
 * A span name: a built-in phase, or an executor's `job.app.<name>`.
 *
 * @stability experimental
 */
export type NodeSpanName = BuiltinNodeSpanName | `job.app.${string}`;

/** Spans per request. A job produces about five; this is ten jobs' worth. */
export const MAX_NODE_SPANS_PER_REQUEST = 50;

/** One day, in milliseconds — the longest span, and the oldest start, accepted. */
export const MAX_NODE_SPAN_DURATION_MS = 24 * 60 * 60 * 1000;
export const MAX_NODE_SPAN_AGE_MS = 24 * 60 * 60 * 1000;

/** How far a span may END in the future: node clock skew, nothing more. */
export const MAX_NODE_SPAN_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Cap on `errorType`. A class or code name, not a sentence. */
export const MAX_NODE_SPAN_ERROR_TYPE_LENGTH = 64;

/** Identifier-shaped only: no spaces, slashes, colons or quotes, so no URL or path fits. */
export const NODE_SPAN_ERROR_TYPE_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** A span name: one of the five phases, or `job.app.<name>`. */
export const nodeSpanNameSchema = z.union([
  z.enum(NODE_SPAN_NAMES),
  z.string().regex(NODE_APP_SPAN_NAME_PATTERN, 'Must be a built-in phase or job.app.<name>'),
]);

/**
 * The attribute bag. The platform's four integers keep their exact bounds
 * (`bytes` is capped at 2^53-1 so it survives JSON exactly; a larger transfer is
 * reported as that ceiling's absence, the CLI omits it, rather than as a rounded
 * number). Any other key is an APP attribute: its key must match
 * `NODE_SPAN_ATTRIBUTE_KEY_PATTERN`, its value is a non-negative integer or a
 * short token-shaped string, and there are at most
 * {@link MAX_NODE_SPAN_ATTRIBUTES} keys in all. Whether an app key is EMITTED is
 * decided by the registry at relay time (`resolveRelayedAttribute`), not here.
 */
export const nodeSpanAttributesSchema = z
  .object({
    bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    attempt: z.number().int().min(0).max(10_000).optional(),
    exitCode: z.number().int().min(-1024).max(1024).optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
  })
  .catchall(
    z.union([
      z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      z.string().min(1).max(MAX_NODE_SPAN_ATTRIBUTE_STRING_LENGTH).regex(NODE_SPAN_ATTRIBUTE_STRING_PATTERN),
    ]),
  )
  .superRefine((attributes, ctx) => {
    const keys = Object.keys(attributes);
    if (keys.length > MAX_NODE_SPAN_ATTRIBUTES) {
      ctx.addIssue({ code: 'custom', message: `At most ${MAX_NODE_SPAN_ATTRIBUTES} attributes per span` });
    }
    for (const key of keys) {
      if (!NODE_SPAN_ATTRIBUTE_KEY_PATTERN.test(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Not an attribute key' });
      }
    }
  });

export type NodeSpanAttributes = z.infer<typeof nodeSpanAttributesSchema>;

export const nodeSpanSchema = z
  .object({
    jobId: z.uuid(),
    name: nodeSpanNameSchema,
    startTimeUnixMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    durationMs: z.number().int().min(0).max(MAX_NODE_SPAN_DURATION_MS),
    status: z.enum(['ok', 'error']),
    errorType: z
      .string()
      .min(1)
      .max(MAX_NODE_SPAN_ERROR_TYPE_LENGTH)
      .regex(NODE_SPAN_ERROR_TYPE_PATTERN, 'Must be an identifier-shaped error class or code')
      .optional(),
    attributes: nodeSpanAttributesSchema.optional(),
  })
  .strict()
  // THE TIME WINDOW, read against the server's clock at parse time. It is a
  // refinement rather than a `.min()` because the bound moves; the static
  // bounds above are what the published schema can state.
  .superRefine((span, ctx) => {
    const now = Date.now();

    if (span.startTimeUnixMs < now - MAX_NODE_SPAN_AGE_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['startTimeUnixMs'],
        message: `Span starts more than ${MAX_NODE_SPAN_AGE_MS / 3_600_000}h in the past`,
      });
    }

    if (span.startTimeUnixMs + span.durationMs > now + MAX_NODE_SPAN_FUTURE_SKEW_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['startTimeUnixMs'],
        message: `Span ends more than ${MAX_NODE_SPAN_FUTURE_SKEW_MS / 60_000} minutes in the future`,
      });
    }
  });

export type NodeSpan = z.infer<typeof nodeSpanSchema>;

/**
 * What a span that failed validation parses to. A span that does not pass
 * `nodeSpanSchema` is DROPPED ON ITS OWN (counted in `dropped`) instead of
 * failing the batch; the published JSON Schema still describes the valid span.
 */
export const INVALID_NODE_SPAN: unique symbol = Symbol('invalid-node-span');

/**
 * Whether a parsed span entry is a real span rather than the marker a failed
 * validation left in its place.
 *
 * @param span - one entry of a parsed `spans` array.
 * @returns true for a span that passed validation.
 */
export function isValidNodeSpan(span: unknown): span is NodeSpan {
  return span !== INVALID_NODE_SPAN;
}

export const nodeTelemetrySchema = z
  .object({
    // The cast is the schema's only lie: zod types `.catch` as the span, and the
    // marker stands in for it until `isValidNodeSpan` filters it out.
    spans: z.array(nodeSpanSchema.catch(INVALID_NODE_SPAN as never)).min(1).max(MAX_NODE_SPANS_PER_REQUEST),
  })
  .strict();

export class NodeTelemetryDto extends createZodDto(nodeTelemetrySchema) {}

/** The response to `POST /nodes/:id/telemetry`. */
export class NodeTelemetryResponseDto {
  @ApiProperty({
    description:
      'Spans attributed to this node and handed to the server’s tracing pipeline. Emission is ' +
      'best-effort: with tracing off, an accepted span is simply discarded by the no-op tracer.',
    minimum: 0,
  })
  accepted!: number;

  @ApiProperty({
    description:
      'Spans refused because they failed validation (an unknown name or attribute shape, a ' +
      'time outside the window) or because their job does not exist or is not attributable to ' +
      'this node (neither held by it now nor settled by it within the grace window). Dropped ' +
      'spans are not an error and must not be resent.',
    minimum: 0,
  })
  dropped!: number;
}
