import { describe, expect, it } from 'vitest';

import { createHostVitalsSampler, parseMemAvailable, type CpuTimes, type HostVitalsSources } from './host-vitals.js';

const times = (busy: number, idle: number): { times: CpuTimes } => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

function sources(overrides: Partial<HostVitalsSources> = {}): HostVitalsSources {
  return {
    cpus: () => [times(0, 0)],
    loadavg: () => [1, 2, 3],
    totalmem: () => 16e9,
    freemem: () => 4e9,
    release: () => '6.1.0-test',
    arch: () => 'x64',
    uptime: () => 1234.5,
    platform: () => 'linux',
    readMeminfo: () => 'MemTotal: 100 kB\nMemAvailable:    2048 kB\n',
    ...overrides,
  };
}

describe('parseMemAvailable', () => {
  it('reads MemAvailable in bytes', () => {
    expect(parseMemAvailable('MemFree: 1 kB\nMemAvailable:   2048 kB\n')).toBe(2048 * 1024);
  });
  it('is undefined when absent', () => {
    expect(parseMemAvailable('MemFree: 1 kB\n')).toBeUndefined();
  });
});

describe('createHostVitalsSampler', () => {
  it('omits cpuPercent on the first sample and computes it from the delta after', () => {
    let current = [times(100, 100), times(100, 100)];
    const sampler = createHostVitalsSampler(sources({ cpus: () => current }));
    const first = sampler.sample();
    expect(first.cpuPercent).toBeUndefined();
    expect(first.cpuCount).toBe(2);
    current = [times(150, 150), times(100, 200)]; // busy +50, total +200 -> 25%... (50)/(100+100+...)
    expect(sampler.sample().cpuPercent).toBeCloseTo(25, 5);
  });

  it('omits cpuPercent when no time passed', () => {
    const sampler = createHostVitalsSampler(sources());
    sampler.sample();
    expect(sampler.sample().cpuPercent).toBeUndefined();
  });

  it('reports memory, load, os and uptime', () => {
    const sample = createHostVitalsSampler(sources()).sample();
    expect(sample).toMatchObject({
      loadAvg1: 1,
      loadAvg5: 2,
      loadAvg15: 3,
      memTotalBytes: 16e9,
      memFreeBytes: 4e9,
      memAvailableBytes: 2048 * 1024,
      osRelease: '6.1.0-test',
      arch: 'x64',
      uptimeSeconds: 1234.5,
    });
  });

  it('falls back to freemem for memAvailable and omits load on win32', () => {
    const sample = createHostVitalsSampler(sources({ readMeminfo: () => undefined, platform: () => 'win32', loadavg: () => [0, 0, 0] })).sample();
    expect(sample.memAvailableBytes).toBe(4e9);
    expect(sample).not.toHaveProperty('loadAvg1');
  });

  it('clamps to the schema bounds and drops garbage', () => {
    const sample = createHostVitalsSampler(
      sources({
        loadavg: () => [99_999, -1, Number.NaN],
        release: () => 'r'.repeat(500),
        arch: () => 'a'.repeat(100),
        totalmem: () => 2 ** 60,
      }),
    ).sample();
    expect(sample.loadAvg1).toBe(10_000);
    expect(sample).not.toHaveProperty('loadAvg5');
    expect(sample).not.toHaveProperty('loadAvg15');
    expect(sample.osRelease).toHaveLength(128);
    expect(sample.arch).toHaveLength(32);
    expect(sample.memTotalBytes).toBe(2 ** 50);
  });

  it('never throws', () => {
    const boom = (): never => {
      throw new Error('x');
    };
    expect(createHostVitalsSampler(sources({ cpus: boom, loadavg: boom, totalmem: boom, freemem: boom, release: boom, arch: boom, uptime: boom, readMeminfo: boom })).sample()).toEqual({});
  });
});
