import { describe, expect, it } from 'vitest';

import {
  binaryCapability,
  evaluateCapabilities,
  probeCapabilities,
  runStartupSelfTest,
  type CapabilityProbe,
  type JobTypeRequirements,
} from './capabilities.js';

const REQUIREMENTS: Record<string, JobTypeRequirements> = {
  'video.transcode': { required: [binaryCapability('ffmpeg')], degradable: [binaryCapability('exiftool')] },
  'example.checksum': { required: [], degradable: [] },
};

function probe(capabilities: string[]): CapabilityProbe {
  return {
    platform: 'linux',
    arch: 'x64',
    nodeVersion: 'v22.0.0',
    cpus: 4,
    totalMemoryMb: 8192,
    freeMemoryMb: 4096,
    binaries: {},
    capabilities,
  };
}

describe('probeCapabilities (issue #276)', () => {
  it('never throws, even when the binary lookup explodes', () => {
    // A probe that can fail turns a diagnostic command into another thing to
    // diagnose.
    expect(() =>
      probeCapabilities({
        binaries: ['ffmpeg'],
        hasBinary: () => {
          throw new Error('exec is not available in this sandbox');
        },
      }),
    ).not.toThrow();
  });

  it('reports a found binary as a capability key', () => {
    const result = probeCapabilities({ binaries: ['ffmpeg'], hasBinary: () => true });
    expect(result.capabilities).toContain('binary:ffmpeg');
    expect(result.binaries.ffmpeg).toBe(true);
  });

  it('reports real machine facts', () => {
    const result = probeCapabilities();
    expect(result.cpus).toBeGreaterThan(0);
    expect(result.nodeVersion).toBe(process.version);
  });
});

describe('evaluateCapabilities', () => {
  it('passes when nothing is required', () => {
    expect(evaluateCapabilities(['example.checksum'], probe([]), REQUIREMENTS).ok).toBe(true);
  });

  it('fails on a missing REQUIRED capability, naming both it and the type', () => {
    const result = evaluateCapabilities(['video.transcode'], probe([]), REQUIREMENTS);
    expect(result.ok).toBe(false);
    expect(result.missingRequired).toContainEqual({ type: 'video.transcode', capability: 'binary:ffmpeg' });
  });

  it('does not fail on a missing DEGRADABLE capability', () => {
    const result = evaluateCapabilities(['video.transcode'], probe(['binary:ffmpeg']), REQUIREMENTS);
    expect(result.ok).toBe(true);
    expect(result.missingDegradable).toContainEqual({ type: 'video.transcode', capability: 'binary:exiftool' });
  });

  it('ignores a type with no declared requirements', () => {
    expect(evaluateCapabilities(['some.fork.type'], probe([]), REQUIREMENTS).ok).toBe(true);
  });
});

describe('runStartupSelfTest', () => {
  it('reports a hard failure naming the capability and the type', () => {
    const failures: string[] = [];
    const warnings: string[] = [];

    const result = runStartupSelfTest({
      types: ['video.transcode'],
      probe: probe([]),
      requirements: REQUIREMENTS,
      warn: (message) => warnings.push(message),
      fail: (message) => failures.push(message),
    });

    expect(result.ok).toBe(false);
    expect(failures.join('\n')).toContain('binary:ffmpeg');
    expect(failures.join('\n')).toContain('video.transcode');
    // And it says what to do — install it, or drop the type.
    expect(failures.join('\n')).toMatch(/--types/);
  });

  it('warns and continues for a degradable gap', () => {
    const failures: string[] = [];
    const warnings: string[] = [];

    const result = runStartupSelfTest({
      types: ['video.transcode'],
      probe: probe(['binary:ffmpeg']),
      requirements: REQUIREMENTS,
      warn: (message) => warnings.push(message),
      fail: (message) => failures.push(message),
    });

    expect(result.ok).toBe(true);
    expect(failures).toEqual([]);
    expect(warnings.join('\n')).toContain('Reduced function');
  });
});
