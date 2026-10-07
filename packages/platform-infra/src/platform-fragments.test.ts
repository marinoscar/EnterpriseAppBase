import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { composeInfraFragment, envInfraFragment, nginxInfraFragment } from './fragments.js';
import { deriveInfraIdentity, renderInfraText } from './identity.js';
import { bodyChecksum, checkInfra, LOCK_PATH, splitGenerated, syncInfra, type InfraLock } from './sync.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const packageFile = (from: string): string => readFileSync(join(PACKAGE_ROOT, from), 'utf8');
const IDENTITY = deriveInfraIdentity({ cliName: 'evopathcli', productName: 'EvoPath' });
const PLATFORM = [composeInfraFragment, nginxInfraFragment, envInfraFragment];
const options = (root: string): { root: string; fragments: typeof PLATFORM; identity: typeof IDENTITY } => ({
  root,
  fragments: PLATFORM,
  identity: IDENTITY,
});

let app: string;
const read = (to: string): string => readFileSync(join(app, to), 'utf8');
const write = (to: string, text: string): void => writeFileSync(join(app, to), text, 'utf8');

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), 'platform-infra-fragments-'));
});

afterEach(() => {
  rmSync(app, { recursive: true, force: true });
});

describe('the platform fragments', () => {
  it('ship every file they name, and generate nothing an app owns', () => {
    for (const fragment of PLATFORM) {
      for (const file of [...fragment.files, ...fragment.appOwnedFiles]) {
        expect(existsSync(join(PACKAGE_ROOT, file.from)), file.from).toBe(true);
        expect(file.to.startsWith('infra/'), file.to).toBe(true);
      }
    }
  });

  it('are frozen', () => {
    expect(Object.isFrozen(composeInfraFragment.files)).toBe(true);
    expect(Object.isFrozen(nginxInfraFragment.appOwnedFiles[0])).toBe(true);
  });
});

describe('syncInfra() with the compose, nginx and env fragments', () => {
  it('renders the identity into the generated files and records it in the lock', () => {
    syncInfra(options(app));
    expect(read('infra/compose/worker.compose.yml')).toContain('EVOPATHCLI_SERVER_URL');
    expect(read('infra/compose/.env.worker.example')).toContain('\nEVOPATHCLI_TOKEN=\n');
    expect(read('infra/compose/base.compose.yml')).toContain('OTEL_SERVICE_NAME=${OTEL_SERVICE_NAME:-evopath-api}');
    expect(read('infra/compose/test.compose.yml')).toContain('container_name: evopath-db-test');
    expect(read('infra/compose/test.compose.yml')).toContain('POSTGRES_DB: evopath_test');
    expect(read('infra/compose/vps.compose.yml')).toContain('(evopathcli deploy generates it)');
    for (const fragment of PLATFORM) {
      for (const file of fragment.files) expect(read(file.to), file.to).not.toContain('@@PLATFORM_');
    }

    const lock = JSON.parse(read(LOCK_PATH)) as InfraLock;
    expect(lock.identity).toEqual(IDENTITY);
    expect(lock.fragments['compose']!.files['infra/compose/worker.compose.yml']).toBe(
      bodyChecksum(renderInfraText(packageFile('compose/worker.compose.yml'), IDENTITY)),
    );
  });

  it('copies the files without placeholders verbatim after the header', () => {
    syncInfra(options(app));
    for (const [to, from] of [
      ['infra/nginx/nginx.conf', 'nginx/nginx.conf'],
      ['infra/nginx/platform/sse-proxy.conf', 'nginx/platform/sse-proxy.conf'],
      ['infra/compose/prod.compose.yml', 'compose/prod.compose.yml'],
    ] as const) {
      expect(splitGenerated(read(to)).body, to).toBe(packageFile(from));
    }
  });

  it('builds .env.example from the platform variables followed by the app-owned app.env.example', () => {
    syncInfra(options(app));
    const platform = renderInfraText(packageFile('env/base.env.example'), IDENTITY);
    expect(read('infra/compose/app.env.example')).toBe(packageFile('env/app.env.example'));
    expect(splitGenerated(read('infra/compose/.env.example')).body).toBe(`${platform}\n${packageFile('env/app.env.example')}`);

    write('infra/compose/app.env.example', '# --- App ---\n# The coach model.\nCOACH_TIMEOUT_MS=30000\n');
    // The app file changed, so the composed .env.example is stale until the next sync.
    expect(checkInfra(options(app)).problems.map((p) => p.file)).toEqual([expect.stringMatching(/^infra\/compose\/\.env\.example:\d+$/)]);
    syncInfra(options(app));
    expect(read('infra/compose/.env.example').endsWith('\n\n# --- App ---\n# The coach model.\nCOACH_TIMEOUT_MS=30000\n')).toBe(true);
    expect(read('infra/compose/app.env.example')).toBe('# --- App ---\n# The coach model.\nCOACH_TIMEOUT_MS=30000\n');
    expect(checkInfra(options(app)).problems).toEqual([]);
  });

  it('creates the app.d include points and the default Permissions-Policy once, and keeps the app’s', () => {
    const first = syncInfra(options(app));
    expect(first.created).toEqual(
      expect.arrayContaining([
        'infra/compose/app.example.compose.yml',
        'infra/nginx/app.d/permissions-policy.conf',
        'infra/nginx/app.d/http/.gitkeep',
        'infra/nginx/app.d/server/.gitkeep',
        'infra/nginx/app.d/locations/.gitkeep',
      ]),
    );

    write('infra/nginx/app.d/permissions-policy.conf', 'add_header Permissions-Policy "geolocation=(self)" always;\n');
    unlinkSync(join(app, 'infra/nginx/app.d/locations/.gitkeep'));
    write('infra/nginx/app.d/locations/coach.conf', 'location /api/coach/chat/stream { include /etc/nginx/platform/sse-proxy.conf; }\n');

    const again = syncInfra(options(app));
    expect(again.created).toEqual([]);
    expect(again.written).toEqual([]);
    expect(read('infra/nginx/app.d/permissions-policy.conf')).toContain('geolocation=(self)');
    // A .gitkeep is only for an empty directory, and never reported missing.
    expect(readdirSync(join(app, 'infra/nginx/app.d/locations'))).toEqual(['coach.conf']);
    expect(checkInfra(options(app)).problems).toEqual([]);
  });

  it('recreates a .gitkeep in an emptied directory', () => {
    syncInfra(options(app));
    rmSync(join(app, 'infra/nginx/app.d/server'), { recursive: true });
    expect(syncInfra(options(app)).created).toEqual(['infra/nginx/app.d/server/.gitkeep']);
  });

  it('reports a hand edit of a rendered file, with the overlay to use instead', () => {
    syncInfra(options(app));
    write('infra/compose/vps.compose.yml', read('infra/compose/vps.compose.yml').replace('memory: 128M', 'memory: 64M'));
    const { problems } = checkInfra(options(app));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.file).toMatch(/^infra\/compose\/vps\.compose\.yml:\d+$/);
    expect(problems[0]!.message).toContain('move your change into an infra/compose/app.*.compose.yml overlay');
  });

  it('reports drift when the identity changes and the files were not re-synced', () => {
    syncInfra(options(app));
    const renamed = { ...options(app), identity: deriveInfraIdentity({ cliName: 'kvoxctl', productName: 'kvox' }) };
    const files = checkInfra(renamed).problems.map((p) => p.file.replace(/:\d+$/, ''));
    expect(files).toEqual(
      expect.arrayContaining([
        'infra/compose/base.compose.yml',
        'infra/compose/worker.compose.yml',
        'infra/compose/test.compose.yml',
        'infra/compose/vps.compose.yml',
        'infra/compose/.env.example',
        'infra/compose/.env.worker.example',
      ]),
    );
    expect(files).not.toContain('infra/nginx/nginx.conf');
    syncInfra(renamed);
    expect(checkInfra(renamed).problems).toEqual([]);
  });

  it('fails the check when the lock was edited by hand', () => {
    syncInfra(options(app));
    const lock = JSON.parse(read(LOCK_PATH)) as InfraLock;
    lock.fragments['nginx']!.files['infra/nginx/nginx.conf'] = '0'.repeat(64);
    write(LOCK_PATH, JSON.stringify(lock));
    expect(checkInfra(options(app)).problems.map((p) => p.file)).toEqual([LOCK_PATH]);
  });
});
