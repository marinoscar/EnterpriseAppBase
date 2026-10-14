import { ConfigService } from '@nestjs/config';

import { TenancyService } from '../../../src/identity/organizations/tenancy.service';
import { currentTenancyMode } from '../../../src/identity/auth/tenancy-mode';

describe('TenancyService (PP-6.2, #722)', () => {
  function serviceFor(raw: string | undefined): TenancyService {
    return new TenancyService({ get: jest.fn(() => raw) } as unknown as ConfigService);
  }

  it('reads tenancy.mode from configuration', () => {
    const get = jest.fn(() => 'multi');
    new TenancyService({ get } as unknown as ConfigService);

    expect(get).toHaveBeenCalledWith('tenancy.mode');
  });

  it('defaults to single when configuration has no value (a stub ConfigService)', () => {
    const service = serviceFor(undefined);

    expect(service.mode()).toBe('single');
    expect(service.isSingle()).toBe(true);
  });

  it('exposes multi', () => {
    const service = serviceFor('multi');

    expect(service.mode()).toBe('multi');
    expect(service.isSingle()).toBe(false);
  });

  it('records the mode for the principal factory (PP-6.3, #723)', () => {
    try {
      serviceFor('multi');
      expect(currentTenancyMode()).toBe('multi');
    } finally {
      serviceFor('single');
    }
    expect(currentTenancyMode()).toBe('single');
  });

  it('fails construction on an invalid value', () => {
    expect(() => serviceFor('Multi')).toThrow(/TENANCY_MODE/);
  });

  it('auto-joins everyone in single mode', () => {
    const service = serviceFor('single');

    expect(service.autoJoinsDefaultOrg(false)).toBe(true);
    expect(service.autoJoinsDefaultOrg(true)).toBe(true);
    expect(service.capabilities.requireActiveMembership).toBe(false);
  });

  it('auto-joins only the initial admin in multi mode, and requires a membership', () => {
    const service = serviceFor('multi');

    expect(service.autoJoinsDefaultOrg(false)).toBe(false);
    expect(service.autoJoinsDefaultOrg(true)).toBe(true);
    expect(service.capabilities.requireActiveMembership).toBe(true);
  });

  it('cannot be switched at runtime: the capabilities object is frozen', () => {
    expect(Object.isFrozen(serviceFor('multi').capabilities)).toBe(true);
  });
});
