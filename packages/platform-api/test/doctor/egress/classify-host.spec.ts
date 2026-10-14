import { EGRESS_MAX_HOSTS, classifyHost, egressDependency, hostnameOf, scopeOfHosts } from '../../../src/doctor';

describe('classifyHost (#773)', () => {
  it.each<[string, 'public' | 'private' | 'unknown']>([
    // private: names
    ['localhost', 'private'],
    ['LOCALHOST', 'private'],
    ['greptimedb', 'private'],
    ['minio', 'private'],
    ['stack-agent', 'private'],
    ['ollama', 'private'],
    ['minio:9000', 'private'],
    ['http://ollama:11434/v1', 'private'],
    ['ollama.internal', 'private'],
    ['smtp.corp.internal', 'private'],
    ['printer.local', 'private'],
    ['nas.lan', 'private'],
    ['router.home.arpa', 'private'],
    ['api.default.svc', 'private'],
    ['api.default.svc.cluster.local', 'private'],
    ['app.localhost', 'private'],
    // private: IPv4
    ['10.0.0.5', 'private'],
    ['10.255.255.255:5432', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.10', 'private'],
    ['127.0.0.1', 'private'],
    ['169.254.169.254', 'private'],
    // private: IPv6
    ['::1', 'private'],
    ['[::1]', 'private'],
    ['[::1]:8080', 'private'],
    ['http://[::1]:11434/v1', 'private'],
    ['fd12:3456:789a::1', 'private'],
    ['fc00::1', 'private'],
    ['fe80::1', 'private'],
    ['[fe80::abcd]', 'private'],
    // public
    ['api.openai.com', 'public'],
    ['https://api.openai.com/v1', 'public'],
    ['contoso.openai.azure.com', 'public'],
    ['acct.r2.cloudflarestorage.com', 'public'],
    ['accounts.google.com', 'public'],
    ['s3.us-east-1.amazonaws.com', 'public'],
    ['internal.example.com', 'public'],
    ['example.local.com', 'public'],
    ['8.8.8.8', 'public'],
    ['172.32.0.1', 'public'],
    ['172.15.0.1', 'public'],
    ['192.169.0.1', 'public'],
    ['2001:4860:4860::8888', 'public'],
    ['[2606:4700::1111]:443', 'public'],
    // unknown
    ['', 'unknown'],
    ['   ', 'unknown'],
    ['http://', 'unknown'],
    ['not a host', 'unknown'],
    ['999.1.1.1', 'unknown'],
    ['[::1', 'unknown'],
    ['bad_host!', 'unknown'],
    ['1:2:3', 'unknown'],
  ])('classifies %j as %s', (host, scope) => {
    expect(classifyHost(host)).toBe(scope);
  });

  it('treats null and undefined as unknown', () => {
    expect(classifyHost(null)).toBe('unknown');
    expect(classifyHost(undefined)).toBe('unknown');
  });
});

describe('hostnameOf (#773)', () => {
  it.each<[string, string | null]>([
    ['https://user:secret-pw@api.openai.com:443/v1/models?key=sk-123#frag', 'api.openai.com'],
    ['smtp.corp.internal', 'smtp.corp.internal'],
    ['minio:9000', 'minio'],
    ['//cdn.example.com/x', 'cdn.example.com'],
    ['HTTP://API.EXAMPLE.COM.', 'api.example.com'],
    ['[::1]:9000', '::1'],
    ['::1', '::1'],
    ['', null],
    ['https://', null],
  ])('reduces %j to %j', (value, host) => {
    expect(hostnameOf(value)).toBe(host);
  });
});

describe('scopeOfHosts (#773)', () => {
  it('takes the worst scope: public > unknown > private', () => {
    expect(scopeOfHosts(['minio', 'api.openai.com'])).toBe('public');
    expect(scopeOfHosts(['minio', ''])).toBe('unknown');
    expect(scopeOfHosts(['minio', '10.0.0.1'])).toBe('private');
  });

  it('is unknown with no host at all', () => {
    expect(scopeOfHosts([])).toBe('unknown');
  });
});

describe('egressDependency (#773)', () => {
  const base = {
    id: 'x',
    capability: 'X',
    direction: 'server' as const,
    enabled: true,
    required: false,
    degradation: 'nothing',
  };

  it('reduces URLs to hostnames, drops empties and duplicates, and computes the scope', () => {
    const dep = egressDependency({
      ...base,
      hosts: ['https://u:p@api.openai.com/v1?k=1', 'api.openai.com', '', null, undefined, 'minio:9000'],
    });

    expect(dep.hosts).toEqual(['api.openai.com', 'minio']);
    expect(dep.scope).toBe('public');
    expect(JSON.stringify(dep)).not.toMatch(/u:p|\/v1|k=1|9000/);
  });

  it('caps hosts at EGRESS_MAX_HOSTS', () => {
    const hosts = Array.from({ length: 50 }, (_, i) => `h${i}.example.com`);

    expect(egressDependency({ ...base, hosts }).hosts).toHaveLength(EGRESS_MAX_HOSTS);
  });

  it('is unknown when nothing parses', () => {
    expect(egressDependency({ ...base, hosts: ['', 'not a host'] })).toMatchObject({ hosts: [], scope: 'unknown' });
  });
});
