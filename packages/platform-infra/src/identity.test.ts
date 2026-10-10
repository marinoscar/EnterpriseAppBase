import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readAppIdentity } from './app-identity.js';
import { DEFAULT_WORKER_IMAGE, deriveInfraIdentity, INFRA_PLACEHOLDERS, renderInfraText } from './identity.js';
import { splitGenerated } from './sync.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const packageFile = (from: string): string => readFileSync(join(PACKAGE_ROOT, from), 'utf8');
const installedBody = (to: string): string => splitGenerated(readFileSync(join(REPO_ROOT, to), 'utf8')).body;

describe('deriveInfraIdentity()', () => {
  it('derives the env prefix from the CLI name the way the CLI does', () => {
    expect(deriveInfraIdentity({ cliName: 'appctl' }).envPrefix).toBe('APPCTL_');
    expect(deriveInfraIdentity({ cliName: 'evopathcli' }).envPrefix).toBe('EVOPATHCLI_');
    expect(deriveInfraIdentity({ cliName: 'acme-ctl' }).envPrefix).toBe('ACME_CTL_');
  });

  it('derives the service and test database names from the product slug', () => {
    expect(deriveInfraIdentity({ cliName: 'acmectl', productName: 'Acme Hub' })).toEqual({
      cliName: 'acmectl',
      envPrefix: 'ACMECTL_',
      serviceName: 'acme-hub-api',
      workerImage: DEFAULT_WORKER_IMAGE,
      testDatabase: 'acme_hub_test',
      testContainer: 'acme-hub-db-test',
    });
  });

  it('falls back to the neutral slug `app` without a product name', () => {
    expect(deriveInfraIdentity({ cliName: 'x' }).serviceName).toBe('app-api');
    expect(deriveInfraIdentity({ cliName: 'x', productName: '!!!' }).testDatabase).toBe('app_test');
  });

  it('takes an explicit value over the derived one', () => {
    const identity = deriveInfraIdentity({ cliName: 'kvox', workerImage: 'ghcr.io/acme/kvox-worker:1.2.3', serviceName: 'kvox' });
    expect(identity.workerImage).toBe('ghcr.io/acme/kvox-worker:1.2.3');
    expect(identity.serviceName).toBe('kvox');
  });

  it.each([
    [{ cliName: 'Appctl' }, /cliName/],
    [{ cliName: '9ctl' }, /cliName/],
    [{ cliName: 'app ctl' }, /cliName/],
    [{ cliName: 'appctl', envPrefix: 'APPCTL' }, /envPrefix/],
    [{ cliName: 'appctl', serviceName: 'a b' }, /serviceName/],
    [{ cliName: 'appctl', workerImage: 'img:${TAG}' }, /workerImage/],
    [{ cliName: 'appctl', serviceName: '@@PLATFORM_CLI_NAME@@' }, /serviceName/],
  ])('refuses %j', (input, message) => {
    expect(() => deriveInfraIdentity(input)).toThrow(message);
  });
});

describe('renderInfraText()', () => {
  const worker = packageFile('compose/worker.compose.yml');

  it('renders the worker fragment with EVOPATHCLI_* variables for evopathcli', () => {
    const rendered = renderInfraText(worker, deriveInfraIdentity({ cliName: 'evopathcli' }));
    expect(rendered).toContain('EVOPATHCLI_SERVER_URL: ${EVOPATHCLI_SERVER_URL:?set EVOPATHCLI_SERVER_URL}');
    expect(rendered).toContain('`evopathcli node enroll`');
    expect(rendered).not.toMatch(/APPCTL_|@@/);
  });

  it('renders the worker fragment for appctl byte for byte as the reference app has it', () => {
    const rendered = renderInfraText(worker, deriveInfraIdentity({ cliName: 'appctl' }));
    expect(rendered).toBe(installedBody('infra/compose/worker.compose.yml'));
    expect(rendered).toContain('APPCTL_TOKEN: ${APPCTL_TOKEN:?set APPCTL_TOKEN}');
    expect(rendered).toContain(`image: \${WORKER_IMAGE:-${DEFAULT_WORKER_IMAGE}}`);
  });

  it('is idempotent: rendering a rendered text changes nothing', () => {
    const identity = deriveInfraIdentity({ cliName: 'evopathcli', productName: 'EvoPath' });
    for (const from of ['compose/worker.compose.yml', 'compose/base.compose.yml', 'compose/test.compose.yml', 'env/base.env.example']) {
      const once = renderInfraText(packageFile(from), identity);
      expect(renderInfraText(once, identity), from).toBe(once);
      expect(renderInfraText(once, {}), from).toBe(once);
    }
  });

  it('leaves a text without placeholders untouched, so no identity is needed', () => {
    const nginx = packageFile('nginx/nginx.conf');
    expect(renderInfraText(nginx, {})).toBe(nginx);
  });

  it('refuses an unknown placeholder and a missing identity field', () => {
    expect(() => renderInfraText('x: @@PLATFORM_NOPE@@', { cliName: 'a' }, 'f.yml')).toThrow(/f\.yml carries the unknown placeholder @@PLATFORM_NOPE@@/);
    expect(() => renderInfraText('x: @@PLATFORM_ENV_PREFIX@@', { cliName: 'a' })).toThrow(/envPrefix/);
  });

  it('defines one placeholder per identity field', () => {
    expect(Object.values(INFRA_PLACEHOLDERS).sort()).toEqual(Object.keys(deriveInfraIdentity({ cliName: 'a' })).sort());
  });

  it('only uses placeholders Compose, nginx and dotenv cannot misread', () => {
    for (const placeholder of Object.keys(INFRA_PLACEHOLDERS)) {
      expect(placeholder).toMatch(/^@@PLATFORM_[A-Z_]+@@$/);
    }
  });
});

describe('readAppIdentity() on this repository (the reference app)', () => {
  it('reads the product name from packages/shared/identity.json and the CLI name from apps/cli bin', () => {
    const identity = readAppIdentity(REPO_ROOT);
    const bin = Object.keys((JSON.parse(readFileSync(join(REPO_ROOT, 'apps/cli/package.json'), 'utf8')) as { bin: object }).bin);
    expect(identity?.cliName).toBe(bin[0]);
    expect(identity?.serviceName).toMatch(/-api$/);
  });

  it('matches the identity recorded in the lock', () => {
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'infra/platform-infra.lock.json'), 'utf8')) as { identity: unknown };
    expect(lock.identity).toEqual(readAppIdentity(REPO_ROOT));
  });
});
