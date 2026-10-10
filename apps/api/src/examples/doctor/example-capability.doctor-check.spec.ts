// The app-owned Doctor check example compiles, registers and grades (#879).

import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';

import { ExampleCapabilityDoctorCheck, decideExampleCapability } from './example-capability.doctor-check';

describe('ExampleCapabilityDoctorCheck', () => {
  it('registers itself with the registry from onModuleInit', () => {
    const registry = new DoctorCheckRegistry();
    const check = new ExampleCapabilityDoctorCheck(registry);

    check.onModuleInit();

    expect(registry.get('example.capability')).toBe(check);
    expect(check.dependsOn).toEqual(['db.connection']);
  });

  it('skips when off, fails with a remedy when on and unconfigured, passes when configured', async () => {
    expect(decideExampleCapability({ configured: false, enabled: false }).status).toBe('skip');
    expect(decideExampleCapability({ configured: false, enabled: true })).toMatchObject({
      status: 'fail',
      remedy: expect.stringMatching(/\S{10,}/),
    });
    expect(decideExampleCapability({ configured: true, enabled: true }).status).toBe('pass');

    const check = new ExampleCapabilityDoctorCheck(new DoctorCheckRegistry(), async () => ({ configured: true, enabled: true }));
    await expect(check.run()).resolves.toMatchObject({ status: 'pass' });
  });
});
