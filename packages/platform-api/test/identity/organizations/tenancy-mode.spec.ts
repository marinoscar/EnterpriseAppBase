import {
  DEFAULT_TENANCY_MODE,
  TENANCY_MODES,
  describeTenancyMode,
  parseTenancyMode,
  tenancyCapabilitiesFor,
  verifyTenancyModeAtStartup,
} from './tenancy-mode';

describe('parseTenancyMode (PP-6.2, #722)', () => {
  it.each<[string | undefined, string]>([
    [undefined, 'single'],
    ['', 'single'],
    ['   ', 'single'],
    ['single', 'single'],
    ['multi', 'multi'],
    [' multi ', 'multi'],
    ['\tsingle\n', 'single'],
  ])('parses %j as %s', (raw, expected) => {
    expect(parseTenancyMode(raw)).toBe(expected);
  });

  it.each(['bogus', 'Multi', 'SINGLE', 'single-org', 'multi-org', 'org', 'single,multi'])(
    'refuses %j rather than guessing a mode',
    (raw) => {
      expect(() => parseTenancyMode(raw)).toThrow(/TENANCY_MODE/);
    }
  );

  it('names the variable, the bad value and every allowed value in its message', () => {
    expect(() => parseTenancyMode('bogus')).toThrow(
      /TENANCY_MODE="bogus" is not a valid tenancy mode\. Allowed values: single, multi/
    );
  });

  it('defaults to single, which is every deployment that predates the variable', () => {
    expect(DEFAULT_TENANCY_MODE).toBe('single');
    expect(TENANCY_MODES).toEqual(['single', 'multi']);
  });
});

describe('tenancyCapabilitiesFor (PP-6.2, #722)', () => {
  it('auto-joins in single and requires a membership in multi', () => {
    expect(tenancyCapabilitiesFor('single')).toEqual({
      autoJoinDefaultOrg: true,
      requireActiveMembership: false,
    });
    expect(tenancyCapabilitiesFor('multi')).toEqual({
      autoJoinDefaultOrg: false,
      requireActiveMembership: true,
    });
  });

  it('describes each mode in one startup log line', () => {
    expect(describeTenancyMode('single')).toMatch(/Tenancy mode: single.*default organization/);
    expect(describeTenancyMode('multi')).toMatch(/Tenancy mode: multi.*refused at sign-in/);
  });
});

describe('verifyTenancyModeAtStartup (PP-6.2, #722)', () => {
  it('throws for an invalid value, before anything is logged', () => {
    const logger = { log: jest.fn() };

    expect(() => verifyTenancyModeAtStartup({ TENANCY_MODE: 'bogus' }, logger)).toThrow(
      /TENANCY_MODE.*Allowed values: single, multi/
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('logs the mode exactly once and returns it', () => {
    const logger = { log: jest.fn() };

    expect(verifyTenancyModeAtStartup({ TENANCY_MODE: 'multi' }, logger)).toBe('multi');
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log.mock.calls[0][0]).toContain('Tenancy mode: multi');
  });

  it('treats an unset variable as single', () => {
    expect(verifyTenancyModeAtStartup({}, { log: jest.fn() })).toBe('single');
  });
});
