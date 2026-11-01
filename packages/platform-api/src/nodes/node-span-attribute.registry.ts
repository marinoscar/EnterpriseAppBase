// =============================================================================
// Relayed span attributes: a registry, with a hard bound on what can ride along
// =============================================================================
//
// A worker node relays phase spans that this server re-emits through its own
// OpenTelemetry pipeline (`node-telemetry.service.ts`). What a span may CARRY is
// the dangerous part: it is written into the deployment's trace store, where an
// operator reads it as fact, by a client authenticated only by a node token. So
// the carried attributes are an ALLOWLIST, and this registry is the list.
//
// The platform's four integers (`bytes`, `attempt`, `exitCode`, `httpStatus`)
// are in it, mapped to their OpenTelemetry names. An app adds its own with
// `registerNodeSpanAttribute({ key, type, maxLength? })`: an INTEGER, or a
// SHORT TOKEN-SHAPED STRING (letters, digits and `_ . + -`: no space, slash,
// colon or quote, so no path, URL or sentence fits). An app attribute is
// emitted as `job.app.<key>`, a fixed namespace that cannot collide with the
// identity attributes the server sets itself (`job.id`, `node.id`, ...).
//
// Anything NOT in the list is dropped from the span (the span itself is kept).
// A value of the wrong type or past `maxLength` is dropped the same way.
//
// A static registry: apps register at import time, before bootstrap.
// =============================================================================

import { defineRegistry } from '../core/index';

/**
 * What a registered string attribute value may look like: token-shaped, so a
 * path, a URL or a message cannot ride along.
 *
 * @stability experimental
 */
export const NODE_SPAN_ATTRIBUTE_STRING_PATTERN = /^[A-Za-z0-9_.+-]+$/;

/**
 * What a registered attribute key must look like (the wire key a node sends).
 *
 * @stability experimental
 */
export const NODE_SPAN_ATTRIBUTE_KEY_PATTERN = /^[a-z][A-Za-z0-9]{1,31}$/;

/**
 * Default `maxLength` of a registered string attribute.
 *
 * @stability experimental
 */
export const DEFAULT_NODE_SPAN_ATTRIBUTE_STRING_LENGTH = 64;

/**
 * Hard ceiling on a registered string attribute's `maxLength`.
 *
 * @stability experimental
 */
export const MAX_NODE_SPAN_ATTRIBUTE_STRING_LENGTH = 128;

/**
 * Most attributes one span may carry on the wire, built-ins included.
 *
 * @stability experimental
 */
export const MAX_NODE_SPAN_ATTRIBUTES = 16;

/**
 * One relayed span attribute.
 *
 * @stability experimental
 */
export interface NodeSpanAttributeDefinition {
  /**
   * The key a node sends in a span's `attributes`. Matches
   * `NODE_SPAN_ATTRIBUTE_KEY_PATTERN`. The span attribute is `job.app.<key>`.
   */
  key: string;
  /** `int` is a safe integer (non-negative); `string` is token-shaped ({@link NODE_SPAN_ATTRIBUTE_STRING_PATTERN}). */
  type: 'int' | 'string';
  /** For `string`: the longest value kept. Default 64, at most 128. */
  maxLength?: number | undefined;
}

/**
 * One of the platform's own relayed integers: the OpenTelemetry name it is
 * emitted under and the range it must be in.
 *
 * @stability experimental
 */
export interface BuiltinNodeSpanAttribute {
  /** The OpenTelemetry attribute name (`job.phase.bytes`). */
  otelName: string;
  /** Smallest accepted value. */
  min: number;
  /** Largest accepted value. */
  max: number;
}

/**
 * The span attribute a relayed wire attribute resolves to.
 *
 * @stability experimental
 */
export interface RelayedAttribute {
  /** The OpenTelemetry attribute name to set. */
  name: string;
  /** Its value: an integer, or a token-shaped string for a registered string attribute. */
  value: number | string;
}

const BUILTIN: Record<string, BuiltinNodeSpanAttribute> = {
  bytes: { otelName: 'job.phase.bytes', min: 0, max: Number.MAX_SAFE_INTEGER },
  attempt: { otelName: 'job.attempt', min: 0, max: 10_000 },
  exitCode: { otelName: 'process.exit_code', min: -1024, max: 1024 },
  httpStatus: { otelName: 'http.response.status_code', min: 100, max: 599 },
};

/**
 * The platform's own relayed integers, by wire key, with their OpenTelemetry
 * names and ranges. Fixed.
 *
 * @stability experimental
 */
export const BUILTIN_NODE_SPAN_ATTRIBUTES: Readonly<Record<string, Readonly<BuiltinNodeSpanAttribute>>> = Object.freeze({ ...BUILTIN });

/**
 * The app-registered relayed attributes.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const nodeSpanAttributeRegistry = defineRegistry<NodeSpanAttributeDefinition>({
  name: 'node-span-attributes',
  idOf: (attribute) => attribute.key,
  idPattern: NODE_SPAN_ATTRIBUTE_KEY_PATTERN,
  validate: (attribute) => {
    if (attribute.key in BUILTIN) throw new Error(`"${attribute.key}" is one of the platform's own attributes`);
    if (attribute.type !== 'int' && attribute.type !== 'string') throw new Error("type must be 'int' or 'string'");
    if (attribute.maxLength !== undefined) {
      if (attribute.type !== 'string') throw new Error('maxLength applies to a string attribute only');
      if (!Number.isInteger(attribute.maxLength) || attribute.maxLength < 1 || attribute.maxLength > MAX_NODE_SPAN_ATTRIBUTE_STRING_LENGTH) {
        throw new Error(`maxLength must be a whole number from 1 to ${MAX_NODE_SPAN_ATTRIBUTE_STRING_LENGTH}`);
      }
    }
  },
});

/**
 * Registers a span attribute a node may relay for an executor's own spans.
 * Call it at import time (an app's `app-registrations/`), before bootstrap. The
 * attribute is emitted as `job.app.<key>`; an attribute nobody registered is
 * dropped from the span, never relayed.
 *
 * @param attribute - the key, the value type and, for a string, its length cap.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerNodeSpanAttribute({ key: 'frames', type: 'int' });
 * registerNodeSpanAttribute({ key: 'codec', type: 'string', maxLength: 16 });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerNodeSpanAttribute(attribute: NodeSpanAttributeDefinition): void {
  nodeSpanAttributeRegistry.register({
    key: attribute.key,
    type: attribute.type,
    ...(attribute.maxLength !== undefined ? { maxLength: attribute.maxLength } : {}),
  });
}

/**
 * Resolves one wire attribute to the span attribute to emit, or `undefined`
 * when it must be dropped (unregistered, wrong type, out of range, too long or
 * not token-shaped). Pure; never throws.
 *
 * @param key - the wire key.
 * @param value - the wire value.
 * @returns the OpenTelemetry attribute name and value to set.
 *
 * @stability experimental
 */
export function resolveRelayedAttribute(key: string, value: unknown): RelayedAttribute | undefined {
  if (Object.hasOwn(BUILTIN, key)) {
    const spec = BUILTIN[key]!;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= spec.min && value <= spec.max
      ? { name: spec.otelName, value }
      : undefined;
  }

  const registered = nodeSpanAttributeRegistry.get(key);
  if (registered === undefined) return undefined;
  const name = `job.app.${registered.key}`;

  if (registered.type === 'int') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? { name, value } : undefined;
  }

  const max = registered.maxLength ?? DEFAULT_NODE_SPAN_ATTRIBUTE_STRING_LENGTH;
  return typeof value === 'string' && value.length >= 1 && value.length <= max && NODE_SPAN_ATTRIBUTE_STRING_PATTERN.test(value)
    ? { name, value }
    : undefined;
}
