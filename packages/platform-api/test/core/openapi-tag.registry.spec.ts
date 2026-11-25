import {
  OPENAPI_TAG_NAME_PATTERN,
  RegistryError,
  listDefinedRegistries,
  openApiTagGroups,
  openApiTags,
  withTemporaryEntries,
  type OpenApiTag,
} from '../../src/core';

/**
 * The OpenAPI tag registry (issue #698): the closed list of `@ApiTags` names
 * in the reference app's `apps/api/src/openapi/tags.ts`, opened so slices and
 * apps register their own tags. The app-level proof that the published
 * document is unchanged is apps/api/test/openapi/openapi-document.spec.ts.
 */

const tag = (name: string, group: string, description = `${name} routes.`): OpenApiTag => ({ name, description, group });

describe('openApiTags', () => {
  it('is a defineRegistry registry, so RegistryFreezeService freezes it on bootstrap', () => {
    expect(listDefinedRegistries().map((registry) => registry.name)).toContain('openapi-tags');
  });

  it('starts empty: the package registers no tags of its own', () => {
    expect(openApiTags.list()).toEqual([]);
  });

  it('keeps registration order and looks tags up by name', async () => {
    await withTemporaryEntries(
      openApiTags,
      [tag('Authentication', 'Authentication & Access'), tag('Personal Access Tokens', 'Authentication & Access')],
      async () => {
        expect(openApiTags.ids()).toEqual(['Authentication', 'Personal Access Tokens']);
        expect(openApiTags.require('Personal Access Tokens').group).toBe('Authentication & Access');
      },
    );
  });

  it('refuses a duplicate tag name', async () => {
    await withTemporaryEntries(openApiTags, [tag('Jobs', 'Operations')], async () => {
      expect(() => openApiTags.register(tag('Jobs', 'Other'))).toThrow(
        expect.objectContaining({ code: 'DUPLICATE_ID' }),
      );
    });
  });

  it('refuses a malformed name, an empty description and a malformed group', () => {
    expect(() => openApiTags.register(tag(' Jobs', 'Operations'))).toThrow(RegistryError);
    expect(() => openApiTags.register(tag('Jobs ', 'Operations'))).toThrow(expect.objectContaining({ code: 'INVALID_ID' }));
    expect(() => openApiTags.register(tag('Jobs', 'Operations', '  '))).toThrow(
      expect.objectContaining({ code: 'INVALID_ENTRY' }),
    );
    expect(() => openApiTags.register(tag('Jobs', ''))).toThrow(expect.objectContaining({ code: 'INVALID_ENTRY' }));
    expect(openApiTags.list()).toEqual([]);
  });

  it('accepts every tag and group name the reference app uses', () => {
    for (const name of [
      'Authentication & Access',
      'Personal Access Tokens',
      'AI Administration',
      'Account & Settings',
      'Notification Broadcasts',
      'AI',
    ]) {
      expect(OPENAPI_TAG_NAME_PATTERN.test(name)).toBe(true);
    }
  });
});

describe('openApiTagGroups', () => {
  it('groups by first appearance and keeps tag order inside each group', () => {
    const groups = openApiTagGroups([
      tag('Authentication', 'Authentication & Access'),
      tag('Users', 'Account & Settings'),
      tag('Allowlist', 'Authentication & Access'),
      tag('Jobs', 'Operations'),
    ]);

    expect(groups).toEqual([
      { name: 'Authentication & Access', tags: ['Authentication', 'Allowlist'] },
      { name: 'Account & Settings', tags: ['Users'] },
      { name: 'Operations', tags: ['Jobs'] },
    ]);
  });

  it('defaults to the registered tags', async () => {
    await withTemporaryEntries(openApiTags, [tag('Health', 'Operations'), tag('About', 'Operations')], async () => {
      expect(openApiTagGroups()).toEqual([{ name: 'Operations', tags: ['Health', 'About'] }]);
    });
  });

  it('returns no groups for no tags', () => {
    expect(openApiTagGroups([])).toEqual([]);
  });
});
