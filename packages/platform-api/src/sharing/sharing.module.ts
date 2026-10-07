import { DynamicModule, Module } from '@nestjs/common';

import { GroupsOrphanedDoctorCheck } from './doctor/groups-orphaned.doctor-check';
import { createGroupInvitesController } from './groups/group-invites.controller';
import { GroupInvitesService } from './groups/group-invites.service';
import { GroupMembershipService } from './groups/group-membership.service';
import { createGroupsController } from './groups/groups.controller';
import { GroupsService } from './groups/groups.service';
import { MemberLookupThrottle } from './groups/member-lookup-throttle';
import { SharingEffects } from './groups/sharing-effects';
import { PrincipalGroupsProvider } from './principal-groups.provider';
import { SHARING_OPTIONS, resolveSharingModuleOptions, type SharingModuleOptions } from './sharing.options';
import { GroupMembershipPurge } from './user-data';

// =============================================================================
// SharingModule (issue #728, PP-7.1; epic #666)
// =============================================================================
//
// The platform's sharing primitives, first slice: groups inside an
// organization, their members (roles `admin`, `editor`, `viewer`) and their
// invites, the ownership contract for app tables (a row owned by a user or by
// a group), and the principal enrichment that fills `Scope.groupIds`.
//
// PACKAGED FROM THE START: nothing here imports the app or identity internals.
// Every app capability comes through a host port (./ports.ts) the app binds in
// `forRoot({ imports })`, and every route through the controller-factory
// recipe with the app's access decorators (`forRoot({ host })`). It depends on
// `core`, `doctor` and `otel-core` only.
// =============================================================================

/**
 * The sharing slice: the `/api/groups` routes, their services, the principal
 * groups provider, the user purge and the `sharing.groups.orphaned` Doctor
 * check.
 *
 * @stability experimental
 */
@Module({})
export class SharingModule {
  /**
   * The slice for one app: its routes guarded by `options.host`, its host
   * ports bound by `options.imports`.
   *
   * @param options - the module options, merged over the defaults.
   * @returns the dynamic module. It exports `PrincipalGroupsProvider`,
   *   `GroupsService`, `GroupMembershipService`, `GroupInvitesService` and
   *   `GroupMembershipPurge`.
   * @throws Error when an option is invalid (the message names it).
   *
   * @example
   * ```ts
   * SharingModule.forRoot({ host: platformHost, imports: [SharingHostModule], groups: { inviteTtlDays: 7 } });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: SharingModuleOptions): DynamicModule {
    const resolved = resolveSharingModuleOptions(options);
    return {
      module: SharingModule,
      imports: [...resolved.imports],
      // The invitee's static `groups/invites/*` routes BEFORE the `groups/:id` routes.
      controllers: [createGroupInvitesController(resolved), createGroupsController(resolved)],
      providers: [
        { provide: SHARING_OPTIONS, useValue: resolved },
        { provide: MemberLookupThrottle, useFactory: () => new MemberLookupThrottle() },
        PrincipalGroupsProvider,
        SharingEffects,
        GroupMembershipService,
        GroupsService,
        GroupInvitesService,
        GroupMembershipPurge,
        GroupsOrphanedDoctorCheck,
      ],
      exports: [PrincipalGroupsProvider, GroupsService, GroupMembershipService, GroupInvitesService, GroupMembershipPurge],
    };
  }
}
