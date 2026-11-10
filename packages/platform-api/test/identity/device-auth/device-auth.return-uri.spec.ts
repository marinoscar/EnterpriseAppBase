import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { DeviceAuthService } from '../../../src/identity/device-auth/device-auth.service';
import { PrismaService } from '../support/app-doubles';
import { AuthService } from '../../../src/identity/auth/auth.service';
import { PatService } from '../../../src/identity/pat/pat.service';
import { createMockPrismaService, MockPrismaService } from '../support/prisma.mock';
import { DEVICE_CODE_STATUS } from '../../../src/identity/data/identity-db';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  resolveIdentityModuleOptions,
} from '../../../src/identity/identity.options';

async function build(schemes?: string[]): Promise<{ service: DeviceAuthService; prisma: MockPrismaService }> {
  const prisma = createMockPrismaService();
  prisma.deviceCode.create.mockResolvedValue({} as any);
  const options = schemes ? resolveIdentityModuleOptions({ deviceFlow: { returnUriSchemes: schemes } }) : DEFAULT_IDENTITY_OPTIONS;
  const module = await Test.createTestingModule({
    providers: [
      DeviceAuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuthService, useValue: {} },
      { provide: PatService, useValue: {} },
      { provide: ConfigService, useValue: { get: (k: string, d?: unknown) => (k === 'appUrl' ? 'http://localhost:3535' : d) } },
      { provide: IDENTITY_OPTIONS, useValue: options },
    ],
  }).compile();
  return { service: module.get(DeviceAuthService), prisma };
}

describe('device flow returnUri', () => {
  it('accepts https and a configured scheme and stores them', async () => {
    const { service, prisma } = await build(['MyApp:']);
    await service.generateDeviceCode({ returnUri: 'myapp://media-sync/paired', tokenType: 'pat' });
    await service.generateDeviceCode({ returnUri: 'https://app.example.test/paired' });
    const stored = prisma.deviceCode.create.mock.calls.map((c: any) => c[0].data.clientInfo.returnUri);
    expect(stored).toEqual(['myapp://media-sync/paired', 'https://app.example.test/paired']);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'http://app.example.test', 'other://x', 'myapp2://x'])(
    'refuses %s with INVALID_RETURN_URI',
    async (returnUri) => {
      const { service, prisma } = await build(['myapp']);
      const error = await service.generateDeviceCode({ returnUri }).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'INVALID_RETURN_URI' });
      expect(prisma.deviceCode.create).not.toHaveBeenCalled();
    },
  );

  it('accepts only https when no scheme is configured', async () => {
    const { service } = await build();
    await expect(service.generateDeviceCode({ returnUri: 'myapp://x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.generateDeviceCode({ returnUri: 'https://a.test/x' })).resolves.toBeDefined();
  });

  it('maps the name alias onto deviceName only when deviceName is absent', async () => {
    const { service, prisma } = await build();
    await service.generateDeviceCode({ name: 'Old phone' });
    await service.generateDeviceCode({ name: 'Old phone', deviceName: 'New phone' });
    const infos = prisma.deviceCode.create.mock.calls.map((c: any) => c[0].data.clientInfo);
    expect(infos[0]).toEqual({ deviceName: 'Old phone' });
    expect(infos[1]).toEqual({ deviceName: 'New phone' });
  });

  it('echoes a still-allowed returnUri on activate and drops a no-longer-allowed one', async () => {
    const { service, prisma } = await build();
    const row = (returnUri: string) => ({
      userCode: 'ABCD-1234',
      status: DEVICE_CODE_STATUS.pending,
      clientInfo: { deviceName: 'x', returnUri },
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.deviceCode.findUnique.mockResolvedValueOnce(row('https://a.test/x') as any);
    expect((await service.getActivationInfo('ABCD-1234')).clientInfo).toMatchObject({ returnUri: 'https://a.test/x' });
    prisma.deviceCode.findUnique.mockResolvedValueOnce(row('myapp://x') as any);
    const info = await service.getActivationInfo('ABCD-1234');
    expect(info.clientInfo).toEqual({ deviceName: 'x' });
  });

  it('rejects an unusable scheme in forRoot options', () => {
    expect(() => resolveIdentityModuleOptions({ deviceFlow: { returnUriSchemes: ['javascript'] } })).toThrow(/returnUriSchemes/);
    expect(() => resolveIdentityModuleOptions({ deviceFlow: { returnUriSchemes: ['bad scheme'] } })).toThrow(/returnUriSchemes/);
  });
});
