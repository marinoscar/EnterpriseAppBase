// =============================================================================
// The metadata secret guard (PP-14.27)
// =============================================================================
//
// `users.metadata` and `organizations.metadata` are free-form JSONB documents
// an app fills. They are NOT a secret store: a document is copied into exports,
// backups and (by an app that exposes it) API responses, and nothing encrypts it.
// A secret goes in the encrypted credential store (`user_credentials`,
// `credentials`), never here.
//
// The guard works at two layers, both framework-free:
//
//   1. REGISTRATION: the namespace's zod schema is walked as JSON Schema; a
//      property named like a secret, or a part of the shape left open (`z.any()`,
//      a loose object), is refused, so the shape of a namespace can be reviewed.
//   2. WRITE: the validated value is walked; an object key named like a secret
//      is refused. This closes what the schema cannot see (the keys of a
//      `z.record`).
//
// A guard on names cannot recognise a secret by its value: it is a tripwire for
// the honest mistake, not a defence against a determined author.
// =============================================================================

import { z } from 'zod';

/**
 * Field names that mark a metadata value as a secret, compared
 * case-insensitively with `_`, `-` and `.` ignored: the settings deny-list
 * (`secretAccessKey`, `secretKey`, `sessionToken`, `secret`, `password`,
 * `apiKey`, `token`, `privateKey`) plus `accessToken`, `refreshToken`,
 * `authToken`, `bearer`, `authorization`, `credential`, `credentials`,
 * `passphrase`, `clientSecret` and `signingKey`. A name that merely ends in
 * `secret`, `password`, `passphrase`, `apikey`, `privatekey`, `secretkey`,
 * `signingkey` or `token` after one of those words is refused too
 * (`webhookSecret`, `stripeApiKey`).
 *
 * @stability experimental
 */
export const METADATA_SECRET_FIELD_NAMES = [
  'secretAccessKey',
  'secretKey',
  'sessionToken',
  'secret',
  'password',
  'apiKey',
  'token',
  'privateKey',
  'accessToken',
  'refreshToken',
  'authToken',
  'bearer',
  'authorization',
  'credential',
  'credentials',
  'passphrase',
  'clientSecret',
  'signingKey',
] as const;

const FOLDED_EXACT = new Set(METADATA_SECRET_FIELD_NAMES.map((name) => fold(name)));
const SUFFIXES = ['secret', 'password', 'passphrase', 'apikey', 'privatekey', 'secretkey', 'signingkey', 'accesstoken', 'refreshtoken', 'authtoken', 'sessiontoken'];

function fold(name: string): string {
  return name.toLowerCase().replace(/[._\-\s]/g, '');
}

/**
 * Whether a field name reads as a secret (see {@link METADATA_SECRET_FIELD_NAMES}).
 *
 * @param name - An object key or schema property name.
 * @returns True when the name is one of the deny-list or ends in one of its suffixes.
 * @stability experimental
 */
export function isSecretFieldName(name: string): boolean {
  const folded = fold(name);
  return FOLDED_EXACT.has(folded) || SUFFIXES.some((suffix) => folded.length > suffix.length && folded.endsWith(suffix));
}

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
  additionalProperties?: unknown;
  propertyNames?: unknown;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  prefixItems?: JsonSchemaNode[];
}

/**
 * What the registration walk found wrong in a schema.
 *
 * @stability experimental
 */
export interface MetadataSchemaFindings {
  /** Property paths whose name reads as a secret. */
  secretFields: string[];
  /** Paths whose shape is left open (`z.any()`, `z.unknown()`, `z.date()`, a loose object). */
  openShapes: string[];
  /** True when the root is not an object schema. */
  rootNotObject: boolean;
}

/**
 * Walks a zod schema (as its input JSON Schema) for secret-named properties
 * and open shapes.
 *
 * @param schema - A zod schema.
 * @returns The findings; all empty when the schema is acceptable.
 * @throws Error when the schema cannot be introspected (for example a recursive `z.lazy`).
 * @stability experimental
 */
export function inspectMetadataSchema(schema: z.ZodType): MetadataSchemaFindings {
  const root = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchemaNode;
  const findings: MetadataSchemaFindings = { secretFields: [], openShapes: [], rootNotObject: root.type !== 'object' };
  const visit = (node: JsonSchemaNode, path: string, isRoot: boolean): void => {
    const keys = Object.keys(node).filter((k) => k !== '$schema' && k !== 'description' && k !== 'title' && k !== 'default');
    if (!isRoot && keys.length === 0) findings.openShapes.push(path || '(root)');
    if (node.additionalProperties === true || (typeof node.additionalProperties === 'object' && node.additionalProperties !== null && Object.keys(node.additionalProperties).length === 0)) {
      findings.openShapes.push(`${path || '(root)'} (additional properties)`);
    }
    for (const [name, child] of Object.entries(node.properties ?? {})) {
      const childPath = path ? `${path}.${name}` : name;
      if (isSecretFieldName(name)) findings.secretFields.push(childPath);
      visit(child, childPath, false);
    }
    if (node.additionalProperties && typeof node.additionalProperties === 'object' && Object.keys(node.additionalProperties).length > 0) visit(node.additionalProperties as JsonSchemaNode, `${path}.*`, false);
    const items = node.items;
    if (Array.isArray(items)) items.forEach((item) => visit(item, `${path}[]`, false));
    else if (items) visit(items, `${path}[]`, false);
    for (const list of [node.anyOf, node.oneOf, node.allOf, node.prefixItems]) for (const option of list ?? []) visit(option, path, false);
  };
  visit(root, '', true);
  return findings;
}

/**
 * Every object key in a value, at any depth, that reads as a secret. The write
 * side of the guard: it sees the keys of a `z.record`, which the schema walk
 * cannot.
 *
 * @param value - A JSON value.
 * @param path - The path of `value` (internal).
 * @returns The dotted paths of offending keys; empty when none.
 * @stability experimental
 */
export function findSecretKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSecretKeys(item, `${path}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    return [...(isSecretFieldName(key) ? [here] : []), ...findSecretKeys(child, here)];
  });
}
