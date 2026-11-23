// Scope availability (#1215) in the two discovery documents: an unavailable scope is left out of
// `scopes_supported`, `offline_access` is always kept, and without the input nothing changes.
import { withTemporaryEntries } from '../../../src/core/index';
import { OFFLINE_ACCESS_SCOPE, oauthResourceRegistry, oauthScopeRegistry, type OAuthScopeDefinition } from '../../../src/identity/index';
import { buildAuthorizationServerMetadata } from '../../../src/identity/oauth-server/oauth-metadata';
import { buildProtectedResourceMetadata } from '../../../src/identity/oauth-server/oauth-resource-metadata';
import { OAuthProtocolController } from '../../../src/identity/oauth-server/oauth-protocol.controller';
import { OAuthResourceMetadataController } from '../../../src/identity/oauth-server/oauth-resource-metadata.controller';
import { OAuthServerContext } from '../../../src/identity/oauth-server/oauth-server-context';
import { APP_URL, NOTES_RESOURCE, NOTES_SCOPES } from './support';

const SETTINGS = { dynamicClientRegistration: false, clientIdMetadataDocuments: false } as never;
const asInput = { issuer: APP_URL, settings: SETTINGS, hasDynamicClientRegistration: false, hasClientIdMetadataDocuments: false };

describe('buildAuthorizationServerMetadata availableScopeIds', () => {
  it('without the input, is exactly the output it was before', async () => {
    await withTemporaryEntries(oauthScopeRegistry, NOTES_SCOPES, () => {
      const doc = buildAuthorizationServerMetadata(asInput);
      expect(doc.scopes_supported).toEqual([...oauthScopeRegistry.ids(), OFFLINE_ACCESS_SCOPE].filter((id, i, all) => all.indexOf(id) === i));
      expect(doc.scopes_supported).toEqual(expect.arrayContaining(['notes:read', 'notes:write', 'offline_access']));
      expect(buildAuthorizationServerMetadata({ ...asInput, availableScopeIds: undefined })).toEqual(doc);
    });
  });

  it('with it, lists only those registered scopes and keeps offline_access', async () => {
    await withTemporaryEntries(oauthScopeRegistry, NOTES_SCOPES, () => {
      const doc = buildAuthorizationServerMetadata({ ...asInput, availableScopeIds: ['notes:read'] });
      expect(doc.scopes_supported).toContain('notes:read');
      expect(doc.scopes_supported).toContain('offline_access');
      expect(doc.scopes_supported).not.toContain('notes:write');
    });
  });

  it('with an empty list, keeps only offline_access', async () => {
    await withTemporaryEntries(oauthScopeRegistry, NOTES_SCOPES, () => {
      expect(buildAuthorizationServerMetadata({ ...asInput, availableScopeIds: [] }).scopes_supported).toEqual(['offline_access']);
    });
  });
});

describe('buildProtectedResourceMetadata availableScopeIds', () => {
  const base = { issuer: APP_URL, identifier: `${APP_URL}/api/notes-agent`, resource: NOTES_RESOURCE };

  it('without the input, is exactly the output it was before', () => {
    expect(buildProtectedResourceMetadata(base).scopes_supported).toEqual(['notes:read', 'notes:write', 'offline_access']);
    expect(buildProtectedResourceMetadata({ ...base, availableScopeIds: undefined })).toEqual(buildProtectedResourceMetadata(base));
  });

  it('with it, filters the scopes in order and keeps offline_access', () => {
    expect(buildProtectedResourceMetadata({ ...base, availableScopeIds: ['notes:write'] }).scopes_supported).toEqual(['notes:write', 'offline_access']);
    expect(buildProtectedResourceMetadata({ ...base, availableScopeIds: [] }).scopes_supported).toEqual(['offline_access']);
  });

  it('keeps offline_access when the resource lists it itself', () => {
    const resource = { ...NOTES_RESOURCE, scopes: ['notes:read', 'offline_access'] };
    expect(buildProtectedResourceMetadata({ ...base, resource, availableScopeIds: [] }).scopes_supported).toEqual(['offline_access']);
  });
});

describe('the well-known controllers with an unavailable scope', () => {
  const context = new OAuthServerContext({ get: (key: string) => (key === 'appUrl' ? APP_URL : undefined) } as never);
  const enabled = { isEnabled: async () => true, read: async () => SETTINGS };
  const requestFor = (path: string) => ({ url: path }) as never;

  const hidden = (available: OAuthScopeDefinition['available']): OAuthScopeDefinition[] => [
    ...NOTES_SCOPES,
    { id: 'notes:beta', title: 'Beta notes', description: 'Beta.', permissions: ['notes:read'], risk: 'low', available },
  ];
  const resource = { ...NOTES_RESOURCE, scopes: [...NOTES_RESOURCE.scopes, 'notes:beta'] };

  const protocol = () =>
    new OAuthProtocolController({} as never, {} as never, enabled as never, context, { hasDynamicClientRegistration: false, hasClientIdMetadataDocuments: false } as never, {} as never, {} as never);
  const resourceController = () => new OAuthResourceMetadataController(enabled as never, context);

  it('omits an unavailable scope from both documents, and the predicate gets an empty context', async () => {
    const predicate = jest.fn(() => false);
    await withTemporaryEntries(oauthScopeRegistry, hidden(predicate), () =>
      withTemporaryEntries(oauthResourceRegistry, [resource], async () => {
        const server = await protocol().metadata();
        expect(server.scopes_supported).toEqual(expect.arrayContaining(['notes:read', 'notes:write', 'offline_access']));
        expect(server.scopes_supported).not.toContain('notes:beta');

        const only = await resourceController().only();
        expect(only.scopes_supported).toEqual(['notes:read', 'notes:write', 'offline_access']);
        const byPath = await resourceController().forPath(requestFor('/api/oauth/.well-known/protected-resource/api/notes-agent'));
        expect(byPath.scopes_supported).not.toContain('notes:beta');

        expect(predicate).toHaveBeenCalled();
        for (const call of predicate.mock.calls as unknown[][]) expect(call).toEqual([{}]);
      }),
    );
  });

  it('lists the scope again once the predicate is true', async () => {
    let on = false;
    await withTemporaryEntries(oauthScopeRegistry, hidden(() => on), () =>
      withTemporaryEntries(oauthResourceRegistry, [resource], async () => {
        expect((await protocol().metadata()).scopes_supported).not.toContain('notes:beta');
        on = true;
        expect((await protocol().metadata()).scopes_supported).toContain('notes:beta');
        expect((await resourceController().only()).scopes_supported).toContain('notes:beta');
      }),
    );
  });

  it('treats a throwing predicate as unavailable in the documents', async () => {
    await withTemporaryEntries(oauthScopeRegistry, hidden(() => { throw new Error('boom'); }), () =>
      withTemporaryEntries(oauthResourceRegistry, [resource], async () => {
        expect((await protocol().metadata()).scopes_supported).not.toContain('notes:beta');
        expect((await resourceController().only()).scopes_supported).not.toContain('notes:beta');
      }),
    );
  });
});
