import { resolveApiVersion } from '../../../src/host/openapi/version';

describe('resolveApiVersion', () => {
  const saved = {
    app: process.env.APP_VERSION,
    npm: process.env.npm_package_version,
  };

  afterEach(() => {
    restore('APP_VERSION', saved.app);
    restore('npm_package_version', saved.npm);
  });

  function restore(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it('prefers the version the deploy pipeline stamped on the image', () => {
    process.env.APP_VERSION = '2.7.0';
    process.env.npm_package_version = '1.0.0';
    expect(resolveApiVersion(__dirname)).toBe('2.7.0');
  });

  it('falls back to the npm script environment', () => {
    delete process.env.APP_VERSION;
    process.env.npm_package_version = '1.4.2';
    expect(resolveApiVersion(__dirname)).toBe('1.4.2');
  });

  it('finds the package.json above startDir when neither variable is set', () => {
    delete process.env.APP_VERSION;
    delete process.env.npm_package_version;
    // A bare `node dist/main` has neither variable, which is the case that
    // would otherwise publish a version of "0.0.0" to every reader.
    expect(resolveApiVersion(__dirname)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('degrades to 0.0.0 when no package.json is reachable', () => {
    delete process.env.APP_VERSION;
    delete process.env.npm_package_version;
    expect(resolveApiVersion('/')).toBe('0.0.0');
  });
});
