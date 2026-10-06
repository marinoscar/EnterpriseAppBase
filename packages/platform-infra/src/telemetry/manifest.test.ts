import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { telemetryInfraFragment } from './index.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('telemetryInfraFragment', () => {
  it('names the observability env group', () => {
    expect(telemetryInfraFragment.id).toBe('telemetry');
    expect(telemetryInfraFragment.envGroup).toBe('observability');
  });

  it('puts the services file after prod and the VPS hardening after vps, in that order', () => {
    expect(telemetryInfraFragment.composeFiles).toEqual([
      { file: 'telemetry.compose.yml', slot: 'after-prod' },
      { file: 'vps.telemetry.compose.yml', slot: 'after-vps' },
    ]);
  });

  it('ships every file it materialises', () => {
    for (const file of [...telemetryInfraFragment.files, ...telemetryInfraFragment.appOwnedFiles]) {
      expect(existsSync(join(PACKAGE_ROOT, file.from)), file.from).toBe(true);
      expect(file.from.startsWith('telemetry/'), file.from).toBe(true);
      expect(file.to.startsWith('infra/'), file.to).toBe(true);
    }
  });

  it('materialises each compose file into infra/compose/ under the name the deploy order uses', () => {
    const generated = telemetryInfraFragment.files.map((file) => file.to);
    for (const { file } of telemetryInfraFragment.composeFiles) {
      expect(generated).toContain(`infra/compose/${file}`);
    }
  });

  it('generates the platform collector config and leaves the overlay to the app', () => {
    const { platform, app } = telemetryInfraFragment.collectorConfigs;
    expect(telemetryInfraFragment.files.map((file) => file.to)).toContain(platform);
    expect(telemetryInfraFragment.files.map((file) => file.to)).not.toContain(app);
    expect(telemetryInfraFragment.appOwnedFiles.map((file) => file.to)).toEqual([app]);
    expect(basename(app)).toBe('app-collector.yaml');
  });

  it('references the stack-agent image by repository, without a tag', () => {
    expect(telemetryInfraFragment.images.stackAgent).toBe('ghcr.io/marinoscar/platform-stack-agent');
    expect(telemetryInfraFragment.images.stackAgent).not.toMatch(/:[^/]*$/);
  });

  it('is frozen, so a consumer cannot reorder the deploy by mutating it', () => {
    expect(Object.isFrozen(telemetryInfraFragment)).toBe(true);
    expect(Object.isFrozen(telemetryInfraFragment.composeFiles)).toBe(true);
    expect(Object.isFrozen(telemetryInfraFragment.composeFiles[0])).toBe(true);
    expect(Object.isFrozen(telemetryInfraFragment.files)).toBe(true);
    expect(Object.isFrozen(telemetryInfraFragment.images)).toBe(true);
  });
});
