import { ConfigService } from '@nestjs/config';

import { DatabaseRestoreDisabledError } from '../../db-backup/db-backup.errors';
import {
  DEFAULT_DEPLOYMENT_MODE,
  DEPLOYMENT_MODES,
  capabilitiesFor,
  describeDeploymentMode,
  parseDeploymentMode,
  verifyDeploymentModeAtStartup,
} from './deployment-mode';
import { DeploymentModeService } from './deployment-mode.service';

describe('parseDeploymentMode (#685)', () => {
  it.each<[string | undefined, string]>([
    [undefined, 'self-hosted'],
    ['', 'self-hosted'],
    ['   ', 'self-hosted'],
    ['self-hosted', 'self-hosted'],
    ['saas', 'saas'],
    [' saas ', 'saas'],
    ['\tself-hosted\n', 'self-hosted'],
  ])('parses %j as %s', (raw, expected) => {
    expect(parseDeploymentMode(raw)).toBe(expected);
  });

  it.each(['bogus', 'SaaS', 'SAAS', 'Self-Hosted', 'selfhosted', 'self_hosted', 'cloud', 'on-prem', 'saas,self-hosted'])(
    'refuses %j rather than guessing a mode',
    (raw) => {
      expect(() => parseDeploymentMode(raw)).toThrow(/DEPLOYMENT_MODE/);
    }
  );

  it('names the variable, the bad value and every allowed value in its message', () => {
    expect(() => parseDeploymentMode('bogus')).toThrow(
      /DEPLOYMENT_MODE="bogus" is not a valid deployment mode\. Allowed values: self-hosted, saas/
    );
  });

  it('defaults to self-hosted, which is every deployment that predates the variable', () => {
    expect(DEFAULT_DEPLOYMENT_MODE).toBe('self-hosted');
    expect(DEPLOYMENT_MODES).toEqual(['self-hosted', 'saas']);
  });
});

describe('capabilitiesFor (#685)', () => {
  it('turns in-app restore off in saas only', () => {
    expect(capabilitiesFor('self-hosted')).toEqual({ inAppRestore: true });
    expect(capabilitiesFor('saas')).toEqual({ inAppRestore: false });
  });

  it('describes each mode in one startup log line', () => {
    expect(describeDeploymentMode('saas')).toMatch(/saas.*restore is DISABLED.*point-in-time recovery/);
    expect(describeDeploymentMode('self-hosted')).toMatch(/self-hosted.*restore is available/);
  });
});

describe('verifyDeploymentModeAtStartup (#685) — the bootstrap check, without Nest', () => {
  it('throws for an invalid value, before anything is logged', () => {
    const logger = { log: jest.fn() };

    expect(() => verifyDeploymentModeAtStartup({ DEPLOYMENT_MODE: 'bogus' }, logger)).toThrow(
      /DEPLOYMENT_MODE.*Allowed values: self-hosted, saas/
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('logs the mode exactly once and returns it', () => {
    const logger = { log: jest.fn() };

    expect(verifyDeploymentModeAtStartup({ DEPLOYMENT_MODE: 'saas' }, logger)).toBe('saas');
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log.mock.calls[0][0]).toContain('Deployment mode: saas');
  });

  it('treats an unset variable as self-hosted', () => {
    expect(verifyDeploymentModeAtStartup({}, { log: jest.fn() })).toBe('self-hosted');
  });
});

describe('DeploymentModeService (#685)', () => {
  function serviceFor(raw: string | undefined): DeploymentModeService {
    const config = { get: jest.fn(() => raw) } as unknown as ConfigService;
    return new DeploymentModeService(config);
  }

  it('reads deployment.mode from configuration', () => {
    const get = jest.fn(() => 'saas');
    new DeploymentModeService({ get } as unknown as ConfigService);

    expect(get).toHaveBeenCalledWith('deployment.mode');
  });

  it('exposes the mode and its capabilities', () => {
    const saas = serviceFor('saas');
    expect(saas.mode).toBe('saas');
    expect(saas.capabilities).toEqual({ inAppRestore: false });
    expect(saas.inAppRestoreEnabled).toBe(false);

    const selfHosted = serviceFor(undefined);
    expect(selfHosted.mode).toBe('self-hosted');
    expect(selfHosted.inAppRestoreEnabled).toBe(true);
  });

  it('fails construction on an invalid value, so a container never builds with a guessed mode', () => {
    expect(() => serviceFor('cloud')).toThrow(/DEPLOYMENT_MODE/);
  });

  it('assertInAppRestoreEnabled throws DatabaseRestoreDisabledError in saas', () => {
    const error = (() => {
      try {
        serviceFor('saas').assertInAppRestoreEnabled();
      } catch (caught) {
        return caught;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(DatabaseRestoreDisabledError);
    expect((error as DatabaseRestoreDisabledError).reason).toBe('deployment_mode_saas');
    expect((error as Error).message).toMatch(/point-in-time recovery/);
  });

  it('assertInAppRestoreEnabled is a no-op when self-hosted', () => {
    expect(() => serviceFor('self-hosted').assertInAppRestoreEnabled()).not.toThrow();
  });

  it('cannot be switched at runtime: the capabilities object is frozen', () => {
    const service = serviceFor('saas');

    expect(Object.isFrozen(service.capabilities)).toBe(true);
  });
});
