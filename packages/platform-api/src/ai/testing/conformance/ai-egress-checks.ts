// =============================================================================
// The detectors of the AI secret-egress suite (issue #742)
// =============================================================================
//
// Lifted unchanged from the reference app's `ai-secret-egress.integration.spec.ts`
// into functions, so the package can prove each FAILS on a planted violation
// (`test/ai/testing/ai-egress-checks.spec.ts`): a response schema with a
// key-shaped property, and a haystack carrying a sentinel key.
// =============================================================================

/**
 * Property names (lower-cased) a RESPONSE schema must never publish. Request
 * DTOs legitimately carry `apiKey` IN, which is the point of a write-only key
 * route; what must never happen is a response schema shaped to hold one back out.
 *
 * @stability experimental
 */
export const KEY_SHAPED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'secret',
  'secretkey',
  'secretaccesskey',
  'sessiontoken',
  'apikey',
  'apikeys',
  'password',
  'token',
  'privatekey',
  'rawkey',
]);

/** Unwraps optional/nullable/default wrappers to the schema they wrap. */
function unwrap(schema: any): any {
  let current = schema;
  while (current && typeof current.unwrap === 'function') {
    current = current.unwrap();
  }
  return current;
}

/**
 * Every property name reachable from a Zod schema, however deeply nested:
 * object keys, array elements, union options and record values. Names, never values.
 *
 * @param schema - a Zod schema.
 * @param seen - schema nodes already visited (cycle guard).
 * @returns the property names, in walk order.
 *
 * @stability experimental
 */
export function collectPropertyNames(schema: any, seen = new Set<any>()): string[] {
  const node = unwrap(schema);
  if (!node || seen.has(node)) return [];
  seen.add(node);

  const type = node.def?.type;
  const names: string[] = [];

  if (type === 'object' && node.shape) {
    for (const [key, value] of Object.entries(node.shape)) {
      names.push(key);
      names.push(...collectPropertyNames(value, seen));
    }
  } else if (type === 'array' && node.element) {
    names.push(...collectPropertyNames(node.element, seen));
  } else if ((type === 'union' || type === 'discriminatedUnion') && node.options) {
    for (const option of node.options) names.push(...collectPropertyNames(option, seen));
  } else if (type === 'record' && node.valueType) {
    names.push(...collectPropertyNames(node.valueType, seen));
  }

  return names;
}

/**
 * The properties of a response schema whose name could carry key material.
 *
 * @param schema - a response schema.
 * @returns the offending property names; empty when none is key-shaped.
 *
 * @stability experimental
 */
export function findKeyShapedProperties(schema: unknown): string[] {
  return collectPropertyNames(schema).filter((prop) => KEY_SHAPED_PROPERTY_NAMES.has(prop.toLowerCase()));
}

/**
 * Every `<Schema>.<property>` whose property name looks like a credential
 * (`secret`, `credential`, `apikey`), across a set of response schemas. The
 * result must equal the allowlist (the realtime session's ephemeral secret).
 *
 * @param schemas - response schemas by name.
 * @returns `Name.property` entries, in walk order.
 *
 * @stability experimental
 */
export function findSecretShapedProperties(schemas: Readonly<Record<string, unknown>>): string[] {
  const found: string[] = [];

  for (const [name, schema] of Object.entries(schemas)) {
    for (const prop of collectPropertyNames(schema)) {
      if (/secret|credential|apikey/i.test(prop)) found.push(`${name}.${prop}`);
    }
  }

  return found;
}

/**
 * The sentinels that appear in a haystack (a body, headers, log lines, rows).
 *
 * @param haystack - the captured text.
 * @param sentinels - the values that must never appear.
 * @returns the sentinels found; empty when nothing leaked.
 *
 * @stability experimental
 */
export function findLeakedSentinels(haystack: string, sentinels: readonly string[]): string[] {
  return sentinels.filter((sentinel) => haystack.includes(sentinel));
}
