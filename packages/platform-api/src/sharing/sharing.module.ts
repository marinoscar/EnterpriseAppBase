import { DynamicModule, Logger, Module, type Type } from '@nestjs/common';

import { AccessPolicy } from './access/access-policy.service';
import { GroupsOrphanedDoctorCheck } from './doctor/groups-orphaned.doctor-check';
import { createGrantsController } from './grants/grants.controller';
import { GrantsService } from './grants/grants.service';
import { createGroupInvitesController } from './groups/group-invites.controller';
import { GroupInvitesService } from './groups/group-invites.service';
import { GroupMembershipService } from './groups/group-membership.service';
import { createGroupsController } from './groups/groups.controller';
import { GroupsService } from './groups/groups.service';
import { MemberLookupThrottle } from './groups/member-lookup-throttle';
import { SharingEffects } from './groups/sharing-effects';
import { GrantsPruneHandler } from './jobs/grants-prune.handler';
import { GrantsPruneTask } from './jobs/grants-prune.task';
import { LinkGrantGuard } from './links/link-grant.guard';
import { createLinkGrantsController } from './links/link-grants.controller';
import { LinkGrantsService } from './links/link-grants.service';
import { LinkMissThrottle } from './links/link-miss-throttle';
import { createPublicLinksController } from './links/public-links.controller';
import { PublicLinkInterceptor } from './links/public-link.interceptor';
import { PrincipalGroupsProvider } from './principal-groups.provider';
import { SHARING_OPTIONS, resolveSharingModuleOptions, type SharingModuleOptions } from './sharing.options';
import { GroupMembershipPurge } from './user-data';

// =============================================================================
// SharingModule (issues #728 and #729; epic #666)
// =============================================================================
//
// The platform's sharing primitives, first slice: groups inside an
// organization, their members (roles `admin`, `editor`, `viewer`) and their
// invites, the ownership contract for app tables (a row owned by a user or by
// a group), and the principal enrichment that fills `Scope.groupIds`.
// Second slice (#729): grants (a record shared with a user or a group, with a
// role and an optional expiry), the resource-type registry, `AccessPolicy`
// (`can(principal, action, resource)`), the "resources I can see" helpers,
// `/api/grants` and the server-only `sharing.grants.prune` job.
// Third slice (#730): link grants (`/api/grants/links`), the public
// resolution route `/api/public/links/current` and the public-route pattern
// (`LinkGrantGuard`, `@LinkGrantResource`, `@CurrentLinkGrant`,
// `LinkGrantsService.withLinkScope`).
//
// PACKAGED FROM THE START: nothing here imports the app or identity internals.
// Every app capability comes through a host port (./ports.ts) the app binds in
// `forRoot({ imports })`, and every route through the controller-factory
// recipe with the app's access decorators (`forRoot({ host })`). It depends on
// `core`, `doctor` and `otel-core` only.
// =============================================================================

/**
 * The sharing slice: the `/api/groups`, `/api/grants` and
 * `/api/grants/links` routes, the public `/api/public/links/current`, their
 * services, `AccessPolicy`, `LinkGrantGuard`, the principal groups provider,
 * the user purge, the `sharing.groups.orphaned` Doctor check and the
 * `sharing.grants.prune` job with its daily enqueue.
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
   *   `GroupsService`, `GroupMembershipService`, `GroupInvitesService`,
   *   `GroupMembershipPurge`, `AccessPolicy`, `GrantsService`, `LinkGrantsService`,
   *   `LinkMissThrottle`, `LinkGrantGuard` and `PublicLinkInterceptor`.
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
    // The public link route is public BY DESIGN; it needs the host's marker for that.
    const allowPublic = resolved.host.access.allowPublic?.bind(resolved.host.access);
    if (!allowPublic) {
      new Logger('SharingModule').warn(
        'The platform host has no `access.allowPublic` marker: GET /api/public/links/current is not mounted. ' +
          "App routes behind LinkGrantGuard still work; give the host the app's @Public() to mount it.",
      );
    }
    const controllers: Array<Type<unknown>> = [
      // The invitee's static `groups/invites/*` routes BEFORE the `groups/:id` routes,
      // and the static `grants/links` routes BEFORE `grants/:id`.
      createGroupInvitesController(resolved),
      createGroupsController(resolved),
      createLinkGrantsController(resolved),
      createGrantsController(resolved),
      ...(allowPublic ? [createPublicLinksController(allowPublic)] : []),
    ];
    return {
      module: SharingModule,
      imports: [...resolved.imports],
      controllers,
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
        AccessPolicy,
        GrantsService,
        GrantsPruneHandler,
        GrantsPruneTask,
        LinkGrantsService,
        {
          provide: LinkMissThrottle,
          useFactory: () => new LinkMissThrottle({ maxMisses: resolved.links.maxMissesPerIp, windowMs: resolved.links.missWindowMs }),
        },
        LinkGrantGuard,
        PublicLinkInterceptor,
      ],
      exports: [
        PrincipalGroupsProvider,
        GroupsService,
        GroupMembershipService,
        GroupInvitesService,
        GroupMembershipPurge,
        AccessPolicy,
        GrantsService,
        LinkGrantsService,
        LinkMissThrottle,
        LinkGrantGuard,
        PublicLinkInterceptor,
      ],
    };
  }
}
