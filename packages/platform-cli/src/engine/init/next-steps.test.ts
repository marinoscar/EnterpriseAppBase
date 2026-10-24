import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatNextSteps } from './run-init.js';

// The start command `init` prints is the package's dev order plus the app's
// dev overlays (#714), so a fork's overlay is part of the documented command.
describe('formatNextSteps: the compose command', () => {
  const command = (values: Record<string, string>, composeDir?: string): string =>
    formatNextSteps(new Map(Object.entries(values)), [], composeDir).find((line) => line.includes('docker compose')) ?? '';

  it('is the CLAUDE.md dev command, with devdb when the database is in compose', () => {
    expect(command({ POSTGRES_HOST: 'db' })).toContain('docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml');
    expect(command({ POSTGRES_HOST: 'localhost' })).toContain('docker compose -f base.compose.yml -f dev.compose.yml');
    expect(command({ POSTGRES_HOST: 'localhost' })).not.toContain('devdb');
  });

  it('appends the dev overlays found in infra/compose, and only those', () => {
    const dir = mkdtempSync(join(tmpdir(), 'init-next-steps-'));
    try {
      for (const name of ['app.dev.hot.compose.yml', 'app.all.compose.yml', 'app.vps.limits.compose.yml', 'app.example.compose.yml']) {
        writeFileSync(join(dir, name), 'services: {}\n');
      }
      expect(command({ POSTGRES_HOST: 'db' }, dir)).toContain(
        'docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml -f app.all.compose.yml -f app.dev.hot.compose.yml',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
