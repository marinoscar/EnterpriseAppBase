// =============================================================================
// The test harness of the sharing examples (issue #732): the reference app's
// binding, over a real row-level-security database
// =============================================================================
//
// Boots `SharingModule.forRoot()` with the reference app's own host
// (`platformHost`: the app's `@Auth()` and `@Public()`) and data adapter
// (`SharingDataAdapter` over `PrismaService` / `PrismaSystemService`), plus the
// example controllers and providers, on a throwaway database owned by an
// ordinary role (`createRlsDatabase`), served over Fastify.
//
// Two things differ from production, both at the edge:
//   - authentication: the app's `JwtAuthGuard`, `RolesGuard` and
//     `PermissionsGuard` are overridden by a stand-in that reads the caller
//     from the `x-example-principal` header (see `signIn`) and enforces the
//     route's `@Auth({ permissions })` against that principal;
//   - the in-process event emitter is a plain `EventEmitterModule.forRoot()`.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { randomUUID } from 'node:crypto';

import {
  ForbiddenException,
  Module,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  type ModuleMetadata,
  type Provider,
  type Type,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Principal } from '@marinoscar/platform-api/core';
import { JwtAuthGuard, PERMISSIONS_KEY, PermissionsGuard, RolesGuard } from '@marinoscar/platform-api/identity';
import {
  AccessPolicy,
  GrantsPruneHandler,
  GrantsService,
  GroupInvitesService,
  GroupMembershipService,
  GroupsService,
  LinkGrantsService,
  PrincipalGroupsProvider,
  SHARING_DATA,
  SHARING_EVENT_EMITTER,
  SHARING_TENANCY,
  SharingModule,
  type SharingModuleOptions,
} from '@marinoscar/platform-api/sharing';
import request from 'supertest';

import { platformHost } from '../../../src/platform/platform-host';
import { SharingDataAdapter } from '../../../src/platform/sharing/sharing-data.adapter';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { PrismaSystemService } from '../../../src/prisma/prisma-system.service';
import { rlsServices, type RlsDatabase } from '../../helpers/rls-database.helper';

/** The header the stand-in authentication guard reads. */
export const EXAMPLE_PRINCIPAL_HEADER = 'x-example-principal';

const principals = new Map<string, Principal>();

/** Signs `principal` in for one request: the headers to send. A new principal object per call is a new request. */
export function signIn(principal: Principal): Record<string, string> {
  const key = randomUUID();
  principals.set(key, principal);
  return { [EXAMPLE_PRINCIPAL_HEADER]: key };
}

/** Stands in for the app's `JwtAuthGuard`: the caller comes from the header, as `request.principal`. */
class ExampleAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; principal?: Principal }>();
    const principal = principals.get(req.headers[EXAMPLE_PRINCIPAL_HEADER] ?? '');
    if (!principal) throw new UnauthorizedException();
    req.principal = principal;
    return true;
  }
}

/** Stands in for the app's `PermissionsGuard`: every permission the route's `@Auth({ permissions })` names. */
class ExamplePermissionsGuard implements CanActivate {
  private readonly reflector = new Reflector();
  canActivate(context: ExecutionContext): boolean {
    const needed = this.reflector.getAllAndMerge<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const principal = context.switchToHttp().getRequest<{ principal?: Principal }>().principal;
    const missing = needed.filter((permission) => !principal?.permissions.includes(permission));
    if (missing.length > 0) throw new ForbiddenException(`Missing permission ${missing.join(', ')}`);
    return true;
  }
}

/** What an example spec drives. */
export interface ExampleApp {
  app: INestApplication;
  /** supertest over the Fastify server. */
  http(): ReturnType<typeof request>;
  /** The app's own database services, over the RLS database. */
  prisma: PrismaService;
  system: PrismaSystemService;
  /** The slice's services, as the app injects them. */
  access: AccessPolicy;
  grants: GrantsService;
  links: LinkGrantsService;
  groups: GroupsService;
  members: GroupMembershipService;
  invites: GroupInvitesService;
  principalGroups: PrincipalGroupsProvider;
  prune: GrantsPruneHandler;
  /** Any provider of the module. */
  get<T>(token: Type<T> | string | symbol): T;
  close(): Promise<void>;
}

/** Options of {@link bootExampleApp}. */
export interface ExampleAppOptions {
  /** The example controllers. */
  controllers?: Array<Type<unknown>>;
  /** The example providers (listeners, services). */
  providers?: Provider[];
  /** More modules. */
  imports?: ModuleMetadata['imports'];
  /** The rung-1 options under test (everything but the host and its ports). */
  sharing?: Omit<SharingModuleOptions, 'host' | 'imports'>;
}

/**
 * The reference app's sharing binding over `db`, with the example controllers
 * and providers, listening on Fastify.
 */
export async function bootExampleApp(db: RlsDatabase, options: ExampleAppOptions = {}): Promise<ExampleApp> {
  const { prisma, system, close } = rlsServices(db);

  @Module({
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: PrismaSystemService, useValue: system },
      { provide: SHARING_DATA, useValue: new SharingDataAdapter(prisma, system) },
      { provide: SHARING_EVENT_EMITTER, useExisting: EventEmitter2 },
      { provide: SHARING_TENANCY, useValue: { mode: () => 'single' as const } },
    ],
    exports: [PrismaService, PrismaSystemService, SHARING_DATA, SHARING_EVENT_EMITTER, SHARING_TENANCY],
  })
  class ExampleHostModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [
      EventEmitterModule.forRoot(),
      ExampleHostModule,
      SharingModule.forRoot({
        host: platformHost,
        imports: [ExampleHostModule],
        links: { appUrl: () => 'https://app.example.test' },
        ...options.sharing,
      }),
      ...(options.imports ?? []),
    ],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(new ExampleAuthGuard())
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PermissionsGuard)
    .useValue(new ExamplePermissionsGuard())
    .compile();

  const app = moduleRef.createNestApplication(new FastifyAdapter());
  await app.init();
  await (app.getHttpAdapter().getInstance() as { ready(): Promise<unknown> }).ready();

  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma,
    system,
    access: moduleRef.get(AccessPolicy),
    grants: moduleRef.get(GrantsService),
    links: moduleRef.get(LinkGrantsService),
    groups: moduleRef.get(GroupsService),
    members: moduleRef.get(GroupMembershipService),
    invites: moduleRef.get(GroupInvitesService),
    principalGroups: moduleRef.get(PrincipalGroupsProvider),
    prune: moduleRef.get(GrantsPruneHandler),
    get: (token) => moduleRef.get(token),
    close: async () => {
      await app.close();
      await close();
    },
  };
}
