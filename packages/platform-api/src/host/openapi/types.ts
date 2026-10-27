// =============================================================================
// Minimal structural types for post-processing the generated document
// =============================================================================
//
// `@nestjs/swagger` exports `OpenAPIObject` from its root but not
// `OperationObject`, and reaching into `@nestjs/swagger/dist/interfaces/...` to
// get it couples this code to that package's build layout.
//
// The passes in this directory read and write a handful of fields on operations
// and add vendor extensions, so a structural type with an index signature is
// both sufficient and more honest than the package's own — whose `responses` is
// required, which the generated object does not always satisfy mid-pass.
// =============================================================================

/**
 * One operation of the document, structurally.
 *
 * @stability experimental
 */
export interface DocOperation {
  /** The one-line summary. */
  summary?: string;
  /** The Markdown description. */
  description?: string;
  /** The generated operation id. */
  operationId?: string;
  /** The sidebar tags. */
  tags?: string[];
  /** Responses by status code. */
  responses?: Record<string, unknown>;
  /** Entries are alternatives (OR), not a conjunction. */
  security?: Array<Record<string, string[]>>;
  /** Vendor extensions, including the `x-rbac` stamped by `@Auth()`. */
  [key: string]: unknown;
}

/**
 * One path item: operations by method, plus siblings such as `parameters`.
 *
 * @stability experimental
 */
export type DocPathItem = Record<string, DocOperation | unknown>;

/**
 * The generated document, structurally, for the post-processing passes.
 *
 * @stability experimental
 */
export interface MutableDocument {
  /** Path items by path. */
  paths?: Record<string, DocPathItem | undefined>;
  [key: string]: unknown;
}

/**
 * HTTP methods an OpenAPI path item may carry, in spec order.
 *
 * @stability experimental
 */
export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

/**
 * Visits every operation in the document.
 *
 * Shared by the post-processing passes so the "which keys on a path item are
 * operations" question is answered in exactly one place — `parameters` and
 * `servers` are siblings of the methods and must not be treated as operations.
 *
 * @param document - the document.
 * @param visit - called once per operation with its path and method.
 * @stability experimental
 */
export function forEachOperation(
  document: MutableDocument,
  visit: (operation: DocOperation, path: string, method: string) => void,
): void {
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (!operation || typeof operation !== 'object') continue;
      visit(operation as DocOperation, path, method);
    }
  }
}
