import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_DEPLOYMENT_NETWORK,
  DEPLOYMENT_NETWORKS,
  describeDeploymentNetwork,
  parseDeploymentNetwork,
  verifyDeploymentNetworkAtStartup,
} from '../../../src/host/deployment/deployment-network';
import { DeploymentNetworkService } from '../../../src/host/deployment/deployment-network.service';

describe('parseDeploymentNetwork (#773)', () => {
  it.each<[string | undefined, string]>([
    [undefined, 'online'],
    ['', 'online'],
    ['   ', 'online'],
    ['online', 'online'],
    ['air-gapped', 'air-gapped'],
    [' air-gapped\n', 'air-gapped'],
  ])('parses %j as %s', (raw, expected) => {
    expect(parseDeploymentNetwork(raw)).toBe(expected);
  });

  it.each(['offline', 'Air-Gapped', 'AIR-GAPPED', 'airgapped', 'air_gapped', 'Online', 'true', 'online,air-gapped'])(
    'refuses %j rather than guessing',
    (raw) => {
      expect(() => parseDeploymentNetwork(raw)).toThrow(/DEPLOYMENT_NETWORK/);
    }
  );

  it('names the variable, the bad value and every allowed value', () => {
    expect(() => parseDeploymentNetwork('offline')).toThrow(
      /DEPLOYMENT_NETWORK="offline" is not a valid deployment network\. Allowed values: online, air-gapped/
    );
  });

  it('defaults to online, and shares the doctor slice vocabulary', () => {
    expect(DEFAULT_DEPLOYMENT_NETWORK).toBe('online');
    expect(DEPLOYMENT_NETWORKS).toEqual(['online', 'air-gapped']);
  });
});

describe('verifyDeploymentNetworkAtStartup (#773)', () => {
  it('logs the network once and returns it', () => {
    const log = jest.fn();

    expect(verifyDeploymentNetworkAtStartup({ DEPLOYMENT_NETWORK: 'air-gapped' }, { log })).toBe('air-gapped');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(describeDeploymentNetwork('air-gapped'));
  });

  it('fails startup on an invalid value, before anything is logged', () => {
    const log = jest.fn();

    expect(() => verifyDeploymentNetworkAtStartup({ DEPLOYMENT_NETWORK: 'offline' }, { log })).toThrow(
      /DEPLOYMENT_NETWORK/
    );
    expect(log).not.toHaveBeenCalled();
  });
});

describe('DeploymentNetworkService (#773)', () => {
  const service = (value: string | undefined) =>
    new DeploymentNetworkService({ get: () => value } as unknown as ConfigService);

  it('parses deployment.network once', () => {
    expect(service(undefined).network).toBe('online');
    expect(service(undefined).airGapped).toBe(false);
    expect(service('air-gapped').network).toBe('air-gapped');
    expect(service('air-gapped').airGapped).toBe(true);
  });

  it('refuses to build on an invalid value', () => {
    expect(() => service('offline')).toThrow(/DEPLOYMENT_NETWORK/);
  });
});
