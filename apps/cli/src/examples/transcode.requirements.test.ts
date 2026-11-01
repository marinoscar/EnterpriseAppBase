import { createCli } from '@marinoscar/platform-cli';
import { binaryCapability, evaluateCapabilities, probeCapabilities, runStartupSelfTest } from '@marinoscar/platform-cli/node';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { declareTranscodeRequirements } from './transcode.executor.js';

// The node self-test and `node doctor` protect an executor through the two
// registrations; this proves them through the package's public seams.

beforeEach(() => {
  resetCliForTests();
  createCli(APP_CLI_OPTIONS);
});
afterEach(() => resetCliForTests());

describe('declareTranscodeRequirements', () => {
  it('stops a node without ffmpeg from claiming example.transcode, naming the type and the tool', () => {
    declareTranscodeRequirements();
    const failures: string[] = [];

    const result = runStartupSelfTest({
      types: ['example.transcode'],
      probe: probeCapabilities({ hasBinary: () => false }),
      fail: (message) => failures.push(message),
    });

    expect(result.ok).toBe(false);
    expect(failures.join('\n')).toContain('example.transcode');
    expect(failures.join('\n')).toContain(binaryCapability('ffmpeg'));
  });

  it('lets a node with ffmpeg claim it, and only warns when the degradable exiftool is missing', () => {
    declareTranscodeRequirements();
    const warnings: string[] = [];

    const result = runStartupSelfTest({
      types: ['example.transcode'],
      probe: probeCapabilities({ hasBinary: (name) => name === 'ffmpeg' }),
      warn: (message) => warnings.push(message),
    });

    expect(result.ok).toBe(true);
    expect(warnings.join('\n')).toContain('binary:exiftool');
  });

  it('captures the ffmpeg version banner when the machine reports one', () => {
    declareTranscodeRequirements();

    const probe = probeCapabilities({ hasBinary: (name) => name === 'ffmpeg', readVersion: () => 'ffmpeg version 6.1' });

    expect(probe.versions).toEqual({ ffmpeg: 'ffmpeg version 6.1' });
    expect(evaluateCapabilities(['example.transcode'], probe).ok).toBe(true);
  });

  it('declares nothing until it is called: a stock node claims types without ffmpeg', () => {
    expect(runStartupSelfTest({ types: ['example.transcode'], probe: probeCapabilities({ hasBinary: () => false }) }).ok).toBe(true);
  });
});
