import { describe, expect, it, vi } from 'vitest';

import { isOpenIdConfigurationPath, openIdConfigurationNotFound, wellKnownApiPath, wellKnownProxy } from '../../build-config/oauth-well-known';

// The dev server answers the OAuth server's root well-known paths the way the nginx
// fragment does (PP-15.6): proxied to the API, and a JSON 404 for openid-configuration.
describe('wellKnownApiPath', () => {
  it.each([
    ['/.well-known/oauth-authorization-server', '/api/oauth/.well-known/authorization-server'],
    ['/.well-known/oauth-authorization-server/api/mcp', '/api/oauth/.well-known/authorization-server'],
    ['/.well-known/oauth-protected-resource', '/api/oauth/.well-known/protected-resource'],
    ['/.well-known/oauth-protected-resource/api/mcp', '/api/oauth/.well-known/protected-resource/api/mcp'],
    ['/.well-known/oauth-protected-resource/api/mcp?x=1', '/api/oauth/.well-known/protected-resource/api/mcp?x=1'],
  ])('maps %s to %s', (from, to) => {
    expect(wellKnownApiPath(from)).toBe(to);
  });

  it('leaves every other path alone', () => {
    expect(wellKnownApiPath('/api/users')).toBeNull();
    expect(wellKnownApiPath('/.well-known/assetlinks.json')).toBeNull();
    expect(wellKnownApiPath('/.well-known/oauth-authorization-serverX')).toBeNull();
  });
});

describe('wellKnownProxy', () => {
  it('proxies the two documents to the API target with the rewrite', () => {
    const proxy = wellKnownProxy('http://localhost:3000');
    expect(Object.keys(proxy)).toEqual(['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource']);
    expect(proxy['/.well-known/oauth-protected-resource']!.target).toBe('http://localhost:3000');
    const rewrite = proxy['/.well-known/oauth-protected-resource']!.rewrite!;
    expect(rewrite('/.well-known/oauth-protected-resource/api/mcp')).toBe('/api/oauth/.well-known/protected-resource/api/mcp');
  });
});

describe('openIdConfigurationNotFound', () => {
  it('recognises the path and its suffixed form only', () => {
    expect(isOpenIdConfigurationPath('/.well-known/openid-configuration')).toBe(true);
    expect(isOpenIdConfigurationPath('/.well-known/openid-configuration/api/mcp')).toBe(true);
    expect(isOpenIdConfigurationPath('/.well-known/openid-configurations')).toBe(false);
  });

  it('answers a JSON 404 and passes everything else on', () => {
    let middleware: (request: { url?: string }, response: Record<string, unknown>, next: () => void) => void = () => undefined;
    const plugin = openIdConfigurationNotFound();
    (plugin.configureServer as unknown as (server: unknown) => void)({
      middlewares: { use: (fn: typeof middleware) => (middleware = fn) },
    });
    const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    middleware({ url: '/.well-known/openid-configuration' }, response, next);
    expect(response.statusCode).toBe(404);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(JSON.parse(String(response.end.mock.calls[0]![0])).error).toBe('not_found');
    expect(next).not.toHaveBeenCalled();
    middleware({ url: '/api/users' }, response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
