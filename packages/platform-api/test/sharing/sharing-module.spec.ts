// SharingModule.forRoot (issue #728): options merged over defaults and
// validated, the invitee's static routes before the :id routes, every route
// guarded, the notification templates, and the Doctor check's verdict.
import { Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import {
  GROUPS_INVITATION_EVENT,
  SHARING_GROUP_DEFAULTS,
  SHARING_PERMISSION_DECLARATIONS,
  SharingModule,
  decideOrphanedGroups,
  defaultSharingPrincipal,
  groupInvitationBrowserTemplate,
  renderGroupInvitationEmail,
  resolveSharingModuleOptions,
  GroupsOrphanedDoctorCheck,
} from '../../src/sharing/index';
import { parseIfMatch } from '../../src/sharing/groups/group-common';
import { definePlatformHost } from '../../src/core/index';
import { fakeData, fakeTx, testHost } from './fakes';

describe('resolveSharingModuleOptions', () => {
  it('merges over the defaults and freezes', () => {
    const resolved = resolveSharingModuleOptions({ host: testHost, groups: { maxMembersPerGroup: 5, inviteTtlDays: null } });
    expect(resolved.groups).toEqual({ ...SHARING_GROUP_DEFAULTS, maxMembersPerGroup: 5, inviteTtlDays: null });
    expect(SHARING_GROUP_DEFAULTS).toEqual({ maxGroupsPerCreator: 100, maxMembersPerGroup: 1000, inviteTtlDays: 14, autoAcceptInvitesOnSignup: false, membershipCacheTtlSeconds: 30 });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('refuses a missing host and a bad limit, naming the option', () => {
    expect(() => resolveSharingModuleOptions({} as never)).toThrow(/host/);
    expect(() => resolveSharingModuleOptions({ host: testHost, groups: { maxGroupsPerCreator: 0 } })).toThrow(/maxGroupsPerCreator/);
    expect(() => resolveSharingModuleOptions({ host: testHost, groups: { inviteTtlDays: 1.5 } })).toThrow(/inviteTtlDays/);
    expect(() => resolveSharingModuleOptions({ host: testHost, groups: { membershipCacheTtlSeconds: -1 } })).toThrow(/membershipCacheTtlSeconds/);
    expect(resolveSharingModuleOptions({ host: testHost, groups: { membershipCacheTtlSeconds: 0 } }).groups.membershipCacheTtlSeconds).toBe(0);
  });

  it('warns that autoAcceptInvitesOnSignup has no effect yet (no user-created event)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    resolveSharingModuleOptions({ host: testHost, groups: { autoAcceptInvitesOnSignup: true } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no effect'));
    warn.mockRestore();
  });

  it('reads request.principal by default', () => {
    expect(defaultSharingPrincipal({ principal: { userId: 'u' } })).toEqual({ userId: 'u' });
    expect(defaultSharingPrincipal({ user: { id: 'u' } })).toBeUndefined();
    expect(defaultSharingPrincipal(null)).toBeUndefined();
  });
});

describe('SharingModule.forRoot', () => {
  it('registers the invitee routes before the :id routes, and guards every handler', () => {
    const calls: string[][] = [];
    const host = definePlatformHost({
      access: {
        requirePermissions: (permissions) => {
          calls.push([...permissions]);
          return (() => undefined) as never;
        },
        requireAuthenticated: () => (() => undefined) as never,
      },
    });
    const module = SharingModule.forRoot({ host });
    const paths = (module.controllers ?? []).map((c) => Reflect.getMetadata(PATH_METADATA, c));
    expect(paths).toEqual(['groups/invites', 'groups']);
    // Every route asks for one of the three org permissions (the probe call aside).
    const real = calls.filter((c) => c[0] !== 'platform:probe');
    expect(new Set(real.flat())).toEqual(new Set(['groups:read', 'groups:write']));
    expect(module.exports).toEqual(expect.arrayContaining([expect.any(Function)]));
  });

  it('declares three org-scope permissions with the matrix grants', () => {
    expect(Object.values(SHARING_PERMISSION_DECLARATIONS).map((p) => [p.id, p.scope, [...p.defaultGrants]])).toEqual([
      ['groups:read', 'org', ['org_admin', 'contributor', 'viewer']],
      ['groups:write', 'org', ['org_admin', 'contributor']],
      ['groups:admin', 'org', ['org_admin']],
    ]);
  });
});

describe('parseIfMatch', () => {
  it('accepts 4, "4" and W/"4"; anything else is absent', () => {
    expect([parseIfMatch('4'), parseIfMatch('"4"'), parseIfMatch('W/"4"'), parseIfMatch(['7'])]).toEqual([4, 4, 4, 7]);
    expect([parseIfMatch(undefined), parseIfMatch('abc'), parseIfMatch('*'), parseIfMatch('-1')]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('the groups.invitation templates', () => {
  const data = { recipientEmail: 'bo@example.com', groupName: '<b>Fam</b>', role: 'editor' as const, invitedBy: 'Ana', expiresAt: '2026-03-15T00:00:00.000Z', signInUrl: 'https://app.example.com/login' };

  it('declares the event on email and browser, not mandatory', () => {
    expect(GROUPS_INVITATION_EVENT).toMatchObject({ key: 'groups.invitation', channels: ['email', 'browser'], defaultEnabled: true });
  });

  it('renders a plain-text browser row with a root-relative link', () => {
    expect(groupInvitationBrowserTemplate(data)).toEqual({ title: 'You are invited to a group', body: 'Join "<b>Fam</b>" as an editor.', link: '/groups/invites' });
  });

  it('builds the e-mail through the kit (every interpolation goes through html), and keeps the name out of the subject', () => {
    const interpolated: unknown[] = [];
    const kit = {
      appName: 'App',
      html: (strings: TemplateStringsArray, ...values: unknown[]) => {
        interpolated.push(...values);
        return { parts: [...strings] };
      },
      empty: {},
      renderLayout: jest.fn(() => '<html/>'),
      plainText: jest.fn(() => 'text'),
      headers: { 'Auto-Submitted': 'auto-generated' },
    };
    const email = renderGroupInvitationEmail(data, kit);
    expect(email).toEqual({ subject: 'You have been invited to join a group on App', html: '<html/>', text: 'text', headers: { 'Auto-Submitted': 'auto-generated' } });
    expect(interpolated).toEqual(expect.arrayContaining(['<b>Fam</b>', 'bo@example.com', 'Ana']));
    expect(kit.renderLayout).toHaveBeenCalledWith(expect.objectContaining({ ctaLabel: 'Sign in', ctaUrl: 'https://app.example.com/login' }));
    expect((kit.plainText.mock.calls[0] as unknown as [{ lines: string[] }])[0].lines[0]).toContain('as an editor');
  });
});

describe('sharing.groups.orphaned', () => {
  it('passes with none and warns with ids only', () => {
    expect(decideOrphanedGroups(0, [])).toMatchObject({ status: 'pass' });
    expect(decideOrphanedGroups(2, ['a', 'b'])).toMatchObject({ status: 'warn', data: { orphaned: 2, sample: 'a,b' } });
  });

  it('reads on the system client with reason doctor and writes nothing', async () => {
    const tx = fakeTx();
    tx.group.count.mockResolvedValue(1);
    tx.group.findMany.mockResolvedValue([{ id: 'g1' }]);
    const data = fakeData(tx);
    const register = jest.fn();
    const check = new GroupsOrphanedDoctorCheck(data, { register } as never);
    check.onModuleInit();
    expect(register).toHaveBeenCalledWith(check);
    expect(await check.run()).toMatchObject({ status: 'warn', data: { orphaned: 1, sample: 'g1' } });
    expect(data.systemReasons).toEqual(['doctor']);
    expect(tx.group.count.mock.calls[0][0].where).toEqual({ members: { none: { role: 'admin' } } });
    for (const d of [tx.group, tx.groupMember, tx.groupInvite]) {
      for (const write of [d.create, d.update, d.updateMany, d.delete, d.deleteMany]) expect(write).not.toHaveBeenCalled();
    }
  });
});
