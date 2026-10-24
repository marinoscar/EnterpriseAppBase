import { defineRegistry, type Registry } from '../registry/index';

// =============================================================================
// OpenAPI tag registry (issue #698)
// =============================================================================
//
// The reference app used to declare every `@ApiTags(...)` name in one closed
// list (`apps/api/src/openapi/tags.ts`): a packaged slice that brings its own
// controllers could not add a tag without editing an app file. This registry
// opens that list. The app and every slice register the tags their
// controllers use, each with a description and the sidebar group it belongs
// to; the app's OpenAPI document builder reads the registry once, after
// bootstrap, and emits the document's `tags` array and `x-tagGroups` from it.
//
// Order is registration order, for tags and for groups (a group appears where
// its first tag was registered). The app registers its own taxonomy first, so
// a slice's tags land after it unless they join an existing group.
//
// Framework-free like the rest of `registry/`: no Nest, no swagger import, so
// a tag manifest can be loaded anywhere.
// =============================================================================

/**
 * One OpenAPI tag: the name a controller passes to `@ApiTags(...)`, its
 * sidebar description, and the sidebar group (`x-tagGroups`) it belongs to.
 *
 * @stability experimental
 * @example
 * ```ts
 * const tag: OpenApiTag = { name: 'Jobs', description: 'Background job queue.', group: 'Operations' };
 * ```
 */
export interface OpenApiTag {
  /** Must match the controller's `@ApiTags(...)` argument byte-for-byte; the registry id. */
  readonly name: string;
  /** One or two sentences, rendered under the section heading in the sidebar. */
  readonly description: string;
  /** The sidebar section (`x-tagGroups` entry) the tag is listed under. */
  readonly group: string;
}

/**
 * One sidebar section of the published document, as emitted in
 * `x-tagGroups`: a group name and its tag names, in registration order.
 *
 * @stability experimental
 * @example
 * ```ts
 * const group: OpenApiTagGroup = { name: 'Operations', tags: ['Health', 'Jobs'] };
 * ```
 */
export interface OpenApiTagGroup {
  /** The group's name, as given in each member tag's `group`. */
  readonly name: string;
  /** Names of the group's tags, in registration order. */
  readonly tags: readonly string[];
}

/**
 * What an OpenAPI tag or group name looks like: words of letters and digits
 * separated by single spaces, with `&`, `.`, `/`, `-`, `(` and `)` allowed
 * inside (`'Authentication & Access'`, `'AI Administration'`). No leading or
 * trailing space.
 *
 * @stability experimental
 * @example
 * ```ts
 * OPENAPI_TAG_NAME_PATTERN.test('Personal Access Tokens'); // true
 * ```
 */
export const OPENAPI_TAG_NAME_PATTERN = /^[A-Za-z0-9(](?:[A-Za-z0-9 &./()-]*[A-Za-z0-9)])?$/;

/**
 * The OpenAPI tag registry: every tag a controller of the application uses,
 * registered at module scope before bootstrap (frozen by
 * `RegistryFreezeService` after it). A duplicate name throws `DUPLICATE_ID`;
 * an empty description, or a group that does not match
 * {@link OPENAPI_TAG_NAME_PATTERN}, throws `INVALID_ENTRY`.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * openApiTags.registerAll([
 *   { name: 'Invoices', description: 'Billing documents.', group: 'Billing' },
 * ]);
 * ```
 */
export const openApiTags: Registry<OpenApiTag> = defineRegistry<OpenApiTag>({
  name: 'openapi-tags',
  idOf: (tag) => tag.name,
  idPattern: OPENAPI_TAG_NAME_PATTERN,
  validate: (tag) => {
    if (typeof tag.description !== 'string' || tag.description.trim().length === 0) {
      throw new Error('description must be a non-empty string');
    }
    if (typeof tag.group !== 'string' || !OPENAPI_TAG_NAME_PATTERN.test(tag.group)) {
      throw new Error(`group must match ${String(OPENAPI_TAG_NAME_PATTERN)}`);
    }
  },
});

/**
 * Group tags into sidebar sections: one group per distinct `group`, in the
 * order each group first appears, each listing its tags in input order.
 *
 * @param tags - The tags to group; defaults to everything registered in
 *   {@link openApiTags}, in registration order.
 * @returns The groups, ready to emit as `x-tagGroups`.
 * @stability experimental
 * @example
 * ```ts
 * document['x-tagGroups'] = openApiTagGroups();
 * ```
 */
export function openApiTagGroups(tags: readonly OpenApiTag[] = openApiTags.list()): OpenApiTagGroup[] {
  const groups = new Map<string, string[]>();
  for (const tag of tags) {
    const members = groups.get(tag.group);
    if (members) members.push(tag.name);
    else groups.set(tag.group, [tag.name]);
  }
  return [...groups].map(([name, members]) => ({ name, tags: members }));
}
