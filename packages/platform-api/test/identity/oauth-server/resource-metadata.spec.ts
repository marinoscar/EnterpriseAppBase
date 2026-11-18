// Protected resource metadata (PP-15.6, RFC 9728): the document builder and the controller, with ONE resource
// registered (so the bare path resolves). Two resources and the whole app are covered by the real-Postgres suite.
import { NotFoundException } from '@nestjs/common';

import { withTemporaryEntries } from '../../../src/core/index';
import { oauthResourceRegistry } from '../../../src/identity/index';
import { OAuthResourceMetadataController } from '../../../src/identity/oauth-server/oauth-resource-metadata.controller';
import { buildProtectedResourceMetadata } from '../../../src/identity/oauth-server/oauth-resource-metadata';
import { OAuthServerContext } from '../../../src/identity/oauth-server/oauth-server-context';
import { APP_URL, NOTES_RESOURCE, OTHER_RESOURCE } from './support';

function controller(enabled = true, appUrl = APP_URL) {
  const config = { get: (key: string) => (key === 'appUrl' ? appUrl : undefined) };
  return new OAuthResourceMetadataController({ isEnabled: async () => enabled } as never, new OAuthServerContext(config as never));
}
const requestFor = (path: string) => ({ url: path }) as never;
const RESOURCE = { ...NOTES_RESOURCE, documentation: 'https://docs.example.test/notes' };

describe('buildProtectedResourceMetadata', () => {
  it('lists the resource scopes with offline_access, header bearer and one authorization server', () => {
    expect(buildProtectedResourceMetadata({ issuer: APP_URL, identifier: `${APP_URL}/api/notes-agent`, resource: RESOURCE })).toEqual({
      resource: `${APP_URL}/api/notes-agent`,
      authorization_servers: [APP_URL],
      scopes_supported: ['notes:read', 'notes:write', 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: 'Notes agent',
      resource_documentation: 'https://docs.example.test/notes',
    });
  });

  it('omits resource_documentation when the resource has none and does not repeat offline_access', () => {
    const doc = buildProtectedResourceMetadata({ issuer: APP_URL, identifier: `${APP_URL}/api/x`, resource: { ...NOTES_RESOURCE, scopes: ['notes:read', 'offline_access'] } });
    expect(doc).not.toHaveProperty('resource_documentation');
    expect(doc.scopes_supported).toEqual(['notes:read', 'offline_access']);
  });
});

describe('OAuthResourceMetadataController with one registered resource', () => {
  const withOne = <T>(fn: () => Promise<T>) => withTemporaryEntries(oauthResourceRegistry, [RESOURCE], fn) as Promise<T>;

  it('serves the bare path as the only resource, and the path form for the same one', async () => {
    await withOne(async () => {
      const only = await controller().only();
      expect(only.resource).toBe(`${APP_URL}/api/notes-agent`);
      expect(await controller().forPath(requestFor('/api/oauth/.well-known/protected-resource/api/notes-agent'))).toEqual(only);
    });
  });

  it('resource is APP_URL plus the path exactly, and both URLs follow APP_URL (trailing slash trimmed)', async () => {
    await withOne(async () => {
      const doc = await controller(true, 'https://other.example.test/').only();
      expect(doc.resource).toBe('https://other.example.test/api/notes-agent');
      expect(doc.authorization_servers).toEqual(['https://other.example.test']);
    });
  });

  it('tolerates a trailing slash and ignores the query string', async () => {
    await withOne(async () => {
      const doc = await controller().forPath(requestFor('/api/oauth/.well-known/protected-resource/api/notes-agent/?x=1'));
      expect(doc.resource).toBe(`${APP_URL}/api/notes-agent`);
    });
  });

  it('404s for a path that matches no resource, a prefix of one and the empty path', async () => {
    await withOne(async () => {
      for (const path of ['/api/oauth/.well-known/protected-resource/api/other', '/api/oauth/.well-known/protected-resource/api', '/api/oauth/.well-known/protected-resource/']) {
        await expect(controller().forPath(requestFor(path))).rejects.toBeInstanceOf(NotFoundException);
      }
    });
  });

  it('404s everywhere while the server is disabled', async () => {
    await withOne(async () => {
      await expect(controller(false).only()).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller(false).forPath(requestFor('/api/oauth/.well-known/protected-resource/api/notes-agent'))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('404s the bare path for two resources, and for none', async () => {
    await expect(controller().only()).rejects.toBeInstanceOf(NotFoundException);
    await withTemporaryEntries(oauthResourceRegistry, [RESOURCE, OTHER_RESOURCE], async () => {
      await expect(controller().only()).rejects.toBeInstanceOf(NotFoundException);
      expect((await controller().forPath(requestFor('/api/oauth/.well-known/protected-resource/api/other-agent'))).resource_name).toBe('Other agent');
    });
  });
});
