// =============================================================================
// The tracer the platform hands the provider adapters (issue #991)
// =============================================================================
//
// The adapters live in `@marinoscar/platform-ai-providers`, which takes a
// structural `AiTracer` instead of importing OpenTelemetry. The platform
// passes the same tracer the adapters built for themselves before the split,
// `trace.getTracer(resolveServiceName())`, created when this module loads
// (as the adapter modules did): a proxy tracer that follows whatever global
// provider is registered when a span starts, so span names and attributes
// are unchanged.
// =============================================================================

import { trace } from '@opentelemetry/api';
import type { AiTracer } from '@marinoscar/platform-ai-providers';

import { resolveServiceName } from '../../otel-core/index';

/** The `ai.provider.call` tracer every built-in provider adapter uses. */
export const PLATFORM_AI_TRACER: AiTracer = trace.getTracer(resolveServiceName());
