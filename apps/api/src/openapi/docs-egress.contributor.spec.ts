import { EgressRegistry } from '@marinoscar/platform-api/doctor';

import { DocsEgressContributor } from './docs-egress.contributor';

describe('DocsEgressContributor (#773)', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.API_DOCS_CDN;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.API_DOCS_CDN;
    else process.env.API_DOCS_CDN = saved;
  });

  const describeNow = async () => (await new DocsEgressContributor(new EgressRegistry()).describe())[0];

  it('registers itself (the catalog example of EgressRegistry.register from app code)', () => {
    const registry = new EgressRegistry();
    const subject = new DocsEgressContributor(registry);
    subject.onModuleInit();

    expect(registry.list()).toEqual([subject]);
  });

  it('defaults to the public CDN and Scalar fonts, browser-side, never required', async () => {
    delete process.env.API_DOCS_CDN;

    expect(await describeNow()).toMatchObject({
      id: 'docs.scalar-cdn',
      direction: 'browser',
      enabled: true,
      required: false,
      hosts: ['cdn.jsdelivr.net', 'fonts.scalar.com'],
      scope: 'public',
    });
  });

  it('takes the host of an API_DOCS_CDN override', async () => {
    process.env.API_DOCS_CDN = 'https://static.corp.internal/npm/@scalar/api-reference';

    expect(await describeNow()).toMatchObject({ enabled: true, hosts: ['static.corp.internal'], scope: 'private' });
  });

  it('is disabled for a same-origin override', async () => {
    process.env.API_DOCS_CDN = '/scalar/api-reference.js';

    expect(await describeNow()).toMatchObject({ enabled: false, hosts: [] });
  });
});
