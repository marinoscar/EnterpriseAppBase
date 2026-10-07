import { EgressRegistry } from '../../../doctor/index';

import { TelemetryConnectionService } from '../../connection/telemetry-connection.service';
import { GreptimeDbEgressContributor } from './greptimedb.egress.contributor';

function setup(host: string, configured: boolean) {
  const connection = {
    describeSnapshot: jest.fn().mockReturnValue({
      source: 'environment',
      host,
      hostMode: 'auto',
      deploymentManaged: true,
      pgPort: 4003,
      database: 'public',
      reader: { user: 'reader', passwordSet: true },
      admin: null,
    }),
    isConfigured: jest.fn().mockReturnValue(configured),
    fingerprint: jest.fn(),
    resolveCredentials: jest.fn(),
  };
  const subject = new GreptimeDbEgressContributor(
    new EgressRegistry(),
    connection as unknown as TelemetryConnectionService,
  );
  return { subject, connection };
}

describe('GreptimeDbEgressContributor (#773)', () => {
  it('reports the in-cluster host as private, from the snapshot alone', async () => {
    const { subject, connection } = setup('greptimedb', true);
    const [dep] = await subject.describe();

    expect(dep).toMatchObject({ id: 'telemetry.greptimedb', enabled: true, hosts: ['greptimedb'], scope: 'private' });
    expect(connection.fingerprint).not.toHaveBeenCalled();
    expect(connection.resolveCredentials).not.toHaveBeenCalled();
    expect(JSON.stringify(dep)).not.toMatch(/reader|4003/);
  });

  it('reports a managed host as public', async () => {
    const [dep] = await setup('greptime.example.cloud', true).subject.describe();

    expect(dep).toMatchObject({ scope: 'public', hosts: ['greptime.example.cloud'] });
  });

  it('is disabled with no connection', async () => {
    const [dep] = await setup('', false).subject.describe();

    expect(dep).toMatchObject({ enabled: false, hosts: [], scope: 'unknown' });
  });
});
