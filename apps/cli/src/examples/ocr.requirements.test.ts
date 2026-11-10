import { createCli } from '@marinoscar/platform-cli';
import { evaluateCapabilities, listCapabilityProbes, probeCapabilities, runStartupSelfTest } from '@marinoscar/platform-cli/node';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { declareOcrRequirements, OCR_JOB_TYPE, OCR_SERVICE_URL_ENV } from './ocr.requirements.js';

// The module and service probes are exercised through the package's public
// seams. No sidecar is running, so the service probe reports "not set" (or
// unreachable) and nothing here needs the network.

beforeEach(() => {
  resetCliForTests();
  createCli(APP_CLI_OPTIONS);
});
afterEach(() => resetCliForTests());

describe('declareOcrRequirements', () => {
  it('registers the module and the service probe under their keys', () => {
    declareOcrRequirements();

    expect(listCapabilityProbes().map((probe) => probe.key)).toEqual(['module:sharp', 'service:ocr']);
  });

  it('stops a node whose OCR sidecar is unset, naming the service key', async () => {
    declareOcrRequirements();
    const failures: string[] = [];

    const result = await runStartupSelfTest({
      types: [OCR_JOB_TYPE],
      probe: await probeCapabilities({ binaries: [], env: {} }),
      fail: (message) => failures.push(message),
    });

    expect(result.ok).toBe(false);
    expect(failures.join('\n')).toContain('service:ocr');
    expect(failures.join('\n')).toContain(`${OCR_SERVICE_URL_ENV} is not set`);
  });

  it('only warns when the degradable image library is installed but fails its check', async () => {
    declareOcrRequirements({
      imageModule: 'vitest',
      loadImageLibrary: async () => {
        throw new Error('native binding failed to load');
      },
    });
    // The sidecar is "up": its probe is replaced by a satisfied capability.
    const probe = await probeCapabilities({ binaries: [], env: {} });
    const withSidecar = { ...probe, capabilities: [...probe.capabilities, 'service:ocr'] };
    const warnings: string[] = [];

    const result = await runStartupSelfTest({ types: [OCR_JOB_TYPE], probe: withSidecar, warn: (message) => warnings.push(message) });

    expect(result.ok).toBe(true);
    expect(result.missingDegradable).toEqual([
      expect.objectContaining({ type: OCR_JOB_TYPE, capability: 'module:vitest', state: 'installed' }),
    ]);
    expect(warnings.join('\n')).toContain('installed but not operational');
  });

  it('declares nothing until it is called: a stock node claims the type', async () => {
    const probe = await probeCapabilities({ binaries: [], env: {} });

    expect(evaluateCapabilities([OCR_JOB_TYPE], probe).ok).toBe(true);
  });
});
