import { describe, expect, it, vi } from 'vitest';

import { createPowerProbe, parseLinuxPowerSupplies, parsePmsetBatt, parseWindowsBattery, type PowerProbeIo } from './power-probe.js';

describe('parseLinuxPowerSupplies', () => {
  it('reports AC with a charging battery', () => {
    expect(
      parseLinuxPowerSupplies([
        { type: 'Mains', online: '1' },
        { type: 'Battery', capacity: '64', status: 'Charging' },
      ]),
    ).toEqual({ source: 'ac', batteryPercent: 64, charging: true });
  });
  it('reports battery when discharging and mains are offline', () => {
    expect(
      parseLinuxPowerSupplies([
        { type: 'Mains', online: '0' },
        { type: 'Battery', capacity: '30', status: 'Discharging', timeToEmptyNow: '5400' },
      ]),
    ).toEqual({ source: 'battery', batteryPercent: 30, charging: false, timeRemainingSeconds: 5400 });
  });
  it('treats Full with no mains entry as AC and ignores peripherals', () => {
    expect(
      parseLinuxPowerSupplies([
        { type: 'Battery', capacity: '100', status: 'Full' },
        { type: 'Battery', capacity: '5', status: 'Discharging', scope: 'Device' },
      ]),
    ).toEqual({ source: 'ac', batteryPercent: 100, charging: false });
  });
  it('desktop: mains online, no battery', () => {
    expect(parseLinuxPowerSupplies([{ type: 'Mains', online: '1' }])).toEqual({ source: 'ac' });
  });
  it('nothing usable is undefined', () => {
    expect(parseLinuxPowerSupplies([])).toBeUndefined();
    expect(parseLinuxPowerSupplies([{ type: 'Mains', online: '0' }])).toBeUndefined();
  });
});

describe('parsePmsetBatt', () => {
  it('AC power, charging', () => {
    const out = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t95%; charging; 1:23 remaining present: true\n";
    expect(parsePmsetBatt(out)).toEqual({ source: 'ac', batteryPercent: 95, charging: true });
  });
  it('battery power with time remaining', () => {
    const out = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t40%; discharging; 2:05 remaining present: true\n";
    expect(parsePmsetBatt(out)).toEqual({ source: 'battery', batteryPercent: 40, charging: false, timeRemainingSeconds: 2 * 3600 + 5 * 60 });
  });
  it('no estimate yet', () => {
    const out = "Now drawing from 'Battery Power'\n -InternalBattery-0\t40%; discharging; (no estimate) present: true\n";
    expect(parsePmsetBatt(out)).toEqual({ source: 'battery', batteryPercent: 40, charging: false });
  });
  it('no battery (desktop)', () => {
    expect(parsePmsetBatt("Now drawing from 'AC Power'\n")).toEqual({ source: 'ac' });
  });
  it('garbage is undefined', () => {
    expect(parsePmsetBatt('nope')).toBeUndefined();
  });
});

describe('parseWindowsBattery', () => {
  it('single object, on battery', () => {
    const json = JSON.stringify({ BatteryStatus: 1, EstimatedChargeRemaining: 55, EstimatedRunTime: 90 });
    expect(parseWindowsBattery(json)).toEqual({ source: 'battery', batteryPercent: 55, charging: false, timeRemainingSeconds: 5400 });
  });
  it('array, on AC and charging, unknown run time', () => {
    const json = JSON.stringify([{ BatteryStatus: 2, EstimatedChargeRemaining: 80, EstimatedRunTime: 71582788 }]);
    expect(parseWindowsBattery(json)).toEqual({ source: 'ac', batteryPercent: 80, charging: false });
    expect(parseWindowsBattery(JSON.stringify({ BatteryStatus: 6, EstimatedChargeRemaining: 10 }))).toMatchObject({ source: 'ac', charging: true });
  });
  it('empty output means no battery', () => {
    expect(parseWindowsBattery('  ')).toEqual({ source: 'ac' });
  });
  it('invalid JSON is undefined', () => {
    expect(parseWindowsBattery('{oops')).toBeUndefined();
  });
});

function io(overrides: Partial<PowerProbeIo> = {}): PowerProbeIo {
  return {
    platform: 'darwin',
    exec: async () => "Now drawing from 'AC Power'\n",
    readdir: () => [],
    readFile: () => undefined,
    readEnv: () => undefined,
    now: () => 0,
    ...overrides,
  };
}

describe('createPowerProbe', () => {
  it('caches for 30 s unless forced', async () => {
    let now = 0;
    const exec = vi.fn(async () => "Now drawing from 'AC Power'\n");
    const probe = createPowerProbe(io({ exec, now: () => now }));
    await probe.read();
    now = 29_000;
    await probe.read();
    expect(exec).toHaveBeenCalledTimes(1);
    await probe.read({ force: true });
    expect(exec).toHaveBeenCalledTimes(2);
    now = 70_000;
    await probe.read();
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('uses the fixed program and args, never a shell', async () => {
    const exec = vi.fn(async () => "Now drawing from 'AC Power'\n");
    await createPowerProbe(io({ exec })).read();
    expect(exec).toHaveBeenCalledWith('pmset', ['-g', 'batt'], 2000);
  });

  it('never throws: a failing command is undefined', async () => {
    const probe = createPowerProbe(io({ exec: async () => Promise.reject(new Error('timeout')) }));
    await expect(probe.read()).resolves.toBeUndefined();
  });

  it('reads linux sysfs through the injected fs', async () => {
    const files: Record<string, string> = {
      '/sys/class/power_supply/AC/type': 'Mains',
      '/sys/class/power_supply/AC/online': '0',
      '/sys/class/power_supply/BAT0/type': 'Battery',
      '/sys/class/power_supply/BAT0/capacity': '18',
      '/sys/class/power_supply/BAT0/status': 'Discharging',
    };
    const probe = createPowerProbe(io({ platform: 'linux', readdir: () => ['AC', 'BAT0'], readFile: (p) => files[p] }));
    await expect(probe.read()).resolves.toEqual({ source: 'battery', batteryPercent: 18, charging: false });
  });

  it('a fixture file overrides everything and is never cached', async () => {
    let body = JSON.stringify({ source: 'battery', batteryPercent: 15, charging: false });
    const exec = vi.fn(async () => '');
    const probe = createPowerProbe(io({ exec, readEnv: () => '/tmp/fixture.json', readFile: () => body }));
    await expect(probe.read()).resolves.toEqual({ source: 'battery', batteryPercent: 15, charging: false });
    body = JSON.stringify({ source: 'ac' });
    await expect(probe.read()).resolves.toEqual({ source: 'ac' });
    expect(exec).not.toHaveBeenCalled();
  });
});
