// The root entry is side-effect free and SDK-free (#991): importing
// `@marinoscar/platform-ai-providers` must load none of the optional provider
// SDKs, so a plain-Node consumer that uses only the core types and one
// provider installs and loads only that provider's SDK.

jest.mock('openai', () => {
  throw new Error('the root entry loaded the openai SDK');
});
jest.mock('@anthropic-ai/sdk', () => {
  throw new Error('the root entry loaded the Anthropic SDK');
});
jest.mock('@google/genai', () => {
  throw new Error('the root entry loaded the Google Gen AI SDK');
});

describe('@marinoscar/platform-ai-providers root entry', () => {
  it('loads without any provider SDK', () => {
    let root: typeof import('../src/index') | undefined;

    jest.isolateModules(() => {
      root = require('../src/index') as typeof import('../src/index');
    });

    expect(typeof root?.AiError).toBe('function');
    expect(typeof root?.parseRetryAfterMs).toBe('function');
  });

  it('does not depend on Nest or OpenTelemetry', () => {
    const { readFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
    const manifest = JSON.parse(readFileSync(`${__dirname}/../package.json`, 'utf8')) as Record<string, Record<string, string> | undefined>;
    const declared = ['dependencies', 'peerDependencies', 'devDependencies'].flatMap((field) => Object.keys(manifest[field] ?? {}));

    expect(declared.filter((name) => /^@nestjs\/|^@opentelemetry\/|^@marinoscar\/|^reflect-metadata$|^rxjs$/.test(name))).toEqual([]);
  });
});
