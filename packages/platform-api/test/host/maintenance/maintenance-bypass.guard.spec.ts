import { ExecutionContext, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { RegistryError } from '../../../src/core/index';
import { withTemporaryEntries } from '../../../src/core/registry/testing';
import { IDENTITY_ROLES } from '../../../src/identity/index';
import {
  MaintenanceGuard,
  maintenanceBypassRegistry,
  registerMaintenanceBypass,
  type MaintenanceBypassDef,
  type MaintenanceBypassPrincipal,
  type MaintenanceBypassRequest,
} from '../../../src/host/index';
import type { MaintenanceModeService, MaintenanceStatus } from '../../../src/host/maintenance/maintenance-mode.service';

const SECRET = 'bypass-spec-secret-bypass-spec-secret';

/**
 * The fail-closed contract of `registerMaintenanceBypass` (PP-14.13), driven
 * through the real guard: a predicate can only ADD an allowance, only for a
 * request that is otherwise blocked, and anything but `true` means "blocked".
 */
describe('MaintenanceGuard bypasses', () => {
  const jwt = new JwtService({ secret: SECRET });
  let reflector: { getAllAndOverride: jest.Mock };
  let maintenance: { resolve: jest.Mock };
  let guard: MaintenanceGuard;

  const status = (overrides: Partial<MaintenanceStatus> = {}) =>
    ({ enabled: true, message: 'Down', allowAdmins: true, startedAt: null, startedById: null, source: 'persisted', ...overrides }) as MaintenanceStatus;

  const makeContext = (request: Record<string, unknown> = {}) => {
    const response = { header: jest.fn() };
    const context = {
      getType: () => 'http',
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ headers: {}, method: 'post', url: '/api/webhooks/payments?x=1', ...request }), getResponse: () => response }),
    } as unknown as ExecutionContext;
    return { context, response };
  };

  const bearer = (payload: Record<string, unknown>) => ({ authorization: `Bearer ${jwt.sign(payload)}` });

  const entry = (id: string, allows: MaintenanceBypassDef['allows']): MaintenanceBypassDef => ({ id, allows });

  const withBypasses = (entries: MaintenanceBypassDef[], fn: () => Promise<void>) =>
    withTemporaryEntries(maintenanceBypassRegistry, entries, fn);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    maintenance = { resolve: jest.fn().mockResolvedValue(status()) };
    guard = new MaintenanceGuard(reflector as unknown as Reflector, maintenance as unknown as MaintenanceModeService, jwt);
  });
  afterEach(() => jest.restoreAllMocks());

  it('starts with no bypass: the window blocks as it always did', async () => {
    expect(maintenanceBypassRegistry.list()).toEqual([]);
    await expect(guard.canActivate(makeContext().context)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  describe('registerMaintenanceBypass', () => {
    it('refuses a bad id, a duplicate and a missing predicate', async () => {
      await withBypasses([], async () => {
        expect(() => registerMaintenanceBypass(entry('X', () => true))).toThrow(RegistryError);
        registerMaintenanceBypass(entry('payments-webhook', () => true));
        expect(() => registerMaintenanceBypass(entry('payments-webhook', () => true))).toThrow(RegistryError);
        expect(() => registerMaintenanceBypass({ id: 'no-allows' } as never)).toThrow(/allows/);
      });
    });
  });

  it('lets a request through when a predicate returns exactly true, and hands it a read-only view', async () => {
    const seen: Array<{ request: MaintenanceBypassRequest; principal: MaintenanceBypassPrincipal }> = [];
    await withBypasses(
      [
        entry('payments-webhook', (request, principal) => {
          seen.push({ request, principal });
          return request.method === 'POST' && request.path === '/api/webhooks/payments';
        }),
      ],
      async () => {
        const { context, response } = makeContext({ headers: { 'X-Signature': 'abc' }, ip: '203.0.113.9' });
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(response.header).not.toHaveBeenCalled();

        const { request, principal } = seen[0];
        expect(request).toMatchObject({ method: 'POST', path: '/api/webhooks/payments', ip: '203.0.113.9' });
        expect(request.headers['x-signature']).toBe('abc');
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.headers)).toBe(true);
        expect(principal).toEqual({ kind: 'anonymous', userId: null, roles: [] });
      },
    );
  });

  it('still blocks a request the predicate does not recognise', async () => {
    await withBypasses([entry('payments-webhook', (request) => request.path === '/api/webhooks/payments')], async () => {
      await expect(guard.canActivate(makeContext({ url: '/api/users' }).context)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('fails closed', () => {
    it.each<[string, MaintenanceBypassDef['allows']]>([
      ['false', () => false],
      ['undefined', () => undefined as never],
      ['null', () => null as never],
      ['a truthy string', () => 'yes' as never],
      ['the number 1', () => 1 as never],
      ['an object', () => ({}) as never],
      ['a promise of false', async () => false],
      ['a promise of a truthy non-boolean', async () => 'true' as never],
      ['a throw', () => { throw new Error('boom'); }],
      ['a rejection', async () => { throw new Error('boom'); }],
    ])('treats %s as not bypassed', async (_name, allows) => {
      await withBypasses([entry('bad', allows)], async () => {
        await expect(guard.canActivate(makeContext().context)).rejects.toBeInstanceOf(ServiceUnavailableException);
      });
    });

    it('treats a predicate that never settles as not bypassed', async () => {
      jest.useFakeTimers();
      try {
        await withBypasses([entry('hangs', () => new Promise<boolean>(() => undefined))], async () => {
          const result = guard.canActivate(makeContext().context).catch((error) => error);
          await jest.advanceTimersByTimeAsync(1500);
          expect(await result).toBeInstanceOf(ServiceUnavailableException);
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('skips a failing predicate and still honours a later one that allows', async () => {
      await withBypasses(
        [entry('first', () => { throw new Error('boom'); }), entry('second', () => true)],
        async () => {
          await expect(guard.canActivate(makeContext().context)).resolves.toBe(true);
        },
      );
    });

    it('cannot change the request the rest of the pipeline sees', async () => {
      const request = { headers: { authorization: 'Bearer nope' }, method: 'POST', url: '/x' };
      await withBypasses(
        [
          entry('mutator', (view) => {
            try {
              (view.headers as Record<string, unknown>)['authorization'] = 'tampered';
              (view as unknown as Record<string, unknown>).path = '/changed';
            } catch {
              // frozen: strict mode throws, which is the point
            }
            return false;
          }),
        ],
        async () => {
          await expect(guard.canActivate(makeContext(request).context)).rejects.toBeInstanceOf(ServiceUnavailableException);
        },
      );
      expect(request.headers.authorization).toBe('Bearer nope');
    });
  });

  describe('runs only for a request that would otherwise be blocked', () => {
    it('never runs when no window is open', async () => {
      maintenance.resolve.mockResolvedValue(status({ enabled: false }));
      const allows = jest.fn().mockReturnValue(false);
      await withBypasses([entry('spy', allows)], async () => {
        await expect(guard.canActivate(makeContext().context)).resolves.toBe(true);
      });
      expect(allows).not.toHaveBeenCalled();
    });

    it('never runs for a route marked @AllowDuringMaintenance()', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const allows = jest.fn().mockReturnValue(false);
      await withBypasses([entry('spy', allows)], async () => {
        await expect(guard.canActivate(makeContext().context)).resolves.toBe(true);
      });
      expect(allows).not.toHaveBeenCalled();
    });

    it('never runs for an admin the built-in rule admits, so it cannot change what an admin sees', async () => {
      const allows = jest.fn().mockReturnValue(false);
      await withBypasses([entry('spy', allows)], async () => {
        const { context } = makeContext({ headers: bearer({ sub: 'admin-1', roles: [IDENTITY_ROLES.ADMIN.id] }) });
        await expect(guard.canActivate(context)).resolves.toBe(true);
      });
      expect(allows).not.toHaveBeenCalled();
    });

    it('does not narrow the admin rule: a predicate that returns false cannot block an admin', async () => {
      await withBypasses([entry('deny-everyone', () => false)], async () => {
        const { context } = makeContext({ headers: bearer({ sub: 'admin-1', roles: [IDENTITY_ROLES.ADMIN.id] }) });
        await expect(guard.canActivate(context)).resolves.toBe(true);
      });
    });

    it('runs for a non-admin session and gives it the VERIFIED claims only', async () => {
      const seen: MaintenanceBypassPrincipal[] = [];
      await withBypasses([entry('spy', (_request, principal) => (seen.push(principal), false))], async () => {
        const { context } = makeContext({ headers: bearer({ sub: 'viewer-1', roles: ['viewer', 7, null] }) });
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
      });
      expect(seen).toEqual([{ kind: 'session', userId: 'viewer-1', roles: ['viewer'] }]);
    });

    it('does not trust a forged or expired token: its claims never reach a predicate', async () => {
      const forged = new JwtService({ secret: 'some-other-secret-some-other-secret' }).sign({ sub: 'admin-1', roles: [IDENTITY_ROLES.ADMIN.id] });
      const seen: MaintenanceBypassPrincipal[] = [];
      await withBypasses([entry('spy', (_request, principal) => (seen.push(principal), false))], async () => {
        const { context } = makeContext({ headers: { authorization: `Bearer ${forged}` } });
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
      });
      expect(seen).toEqual([{ kind: 'anonymous', userId: null, roles: [] }]);
    });

    it('reports a pat_ or nod_ bearer as opaque, never resolving it', async () => {
      const seen: MaintenanceBypassPrincipal[] = [];
      await withBypasses([entry('spy', (_request, principal) => (seen.push(principal), false))], async () => {
        for (const token of ['pat_abc', 'nod_def']) {
          const { context } = makeContext({ headers: { authorization: `Bearer ${token}` } });
          await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
        }
      });
      expect(seen).toEqual([
        { kind: 'opaque', userId: null, roles: [] },
        { kind: 'opaque', userId: null, roles: [] },
      ]);
    });

    it('runs for an admin when allowAdmins is off, because the built-in rule did not admit them', async () => {
      maintenance.resolve.mockResolvedValue(status({ allowAdmins: false }));
      const allows = jest.fn().mockReturnValue(false);
      await withBypasses([entry('spy', allows)], async () => {
        const { context } = makeContext({ headers: bearer({ sub: 'admin-1', roles: [IDENTITY_ROLES.ADMIN.id] }) });
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
      });
      expect(allows).toHaveBeenCalledTimes(1);
    });
  });
});
