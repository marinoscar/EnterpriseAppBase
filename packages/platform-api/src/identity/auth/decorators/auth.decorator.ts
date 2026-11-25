import { applyDecorators, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtension,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { Roles } from './roles.decorator';
import { AnyPermissions, Permissions } from './permissions.decorator';
import { ErrorDto } from '../../../core/index';
import { RoleName, PermissionName } from '../../identity.constants';

/**
 * What `@Auth()` requires beyond authentication.
 *
 * @stability stable
 */
export interface AuthOptions {
  /**
   * SYSTEM roles (held in `user_roles`), any of which admits the caller. Today
   * that is only `ROLES.ADMIN`, the deployment operator: an org role on a
   * membership (`org_admin`, `contributor`, `viewer`) never satisfies it, so
   * gate an org surface with an org permission instead (issue #723).
   */
  roles?: RoleName[];
  /** Permissions, all of which the caller must hold in their effective set (system ∪ current-org grants). */
  permissions?: PermissionName[];
  /**
   * Permissions, AT LEAST ONE of which the caller must hold (#738), checked
   * after `permissions`. For one route two scopes may reach: a system
   * permission (`broadcasts:read`) and its org counterpart
   * (`org_broadcasts:read`); the handler then narrows what the caller sees by
   * which one they hold. Never use it to loosen a single-scope route.
   */
  anyPermissions?: PermissionName[];
}

/**
 * Vendor-extension key under which `@Auth()` records what it is about to
 * enforce. Read back by the host slice's `openapi/rbac-docs.ts` and by the document builder.
 *
 * @stability stable
 */
export const RBAC_EXTENSION_KEY = 'x-rbac';

/**
 * Shape stamped at {@link RBAC_EXTENSION_KEY} on every `@Auth()` operation.
 *
 * @stability stable
 */
export interface RbacExtension {
  /** Always true — `@Auth()` always applies `JwtAuthGuard`. */
  authenticated: true;
  /** The guard admits a caller holding ANY of these system roles. */
  roles: string[];
  /** The guard requires ALL of these permissions. */
  permissions: string[];
  /** The guard requires AT LEAST ONE of these permissions; present only when the route declares some (#738). */
  anyPermissions?: string[];
}

/** Name of the session bearer scheme declared in `src/openapi/document.ts`. */
const SESSION_SCHEME = 'JWT-auth';

/**
 * Combined auth decorator that applies JWT, roles, and permissions guards.
 *
 * It also records the roles and permissions it enforces as an `x-rbac` vendor
 * extension on the operation. The human-readable "**Requires:** …" line is
 * rendered from that extension by a later pass over the finished document
 * (`applyRbacDocs`) rather than being written here.
 *
 * WHY A LATER PASS AND NOT `@ApiOperation({ description })` RIGHT HERE.
 * Decorators evaluate bottom-up and `@nestjs/swagger` merges operation metadata
 * shallowly, so a `description` written by this decorator would race the
 * controller's own `@ApiOperation({ description })` — whichever ran last would
 * silently clobber the other, and which one that is depends on decorator order
 * at each call site. Post-processing appends instead, so hand-written prose and
 * generated requirements always coexist. Recording structured metadata here and
 * rendering it there is what makes that possible.
 *
 * @example
 * ```ts
 * class ExampleController {
 *   // Just authentication
 *   @Auth()
 *   me() {}
 *
 *   // With roles (the caller needs ANY of the system roles)
 *   @Auth({ roles: ['admin'] })
 *   operate() {}
 *
 *   // With permissions (the caller needs ALL of them)
 *   @Auth({ permissions: ['users:read'] })
 *   list() {}
 *
 *   // Combined
 *   @Auth({ roles: ['admin'], permissions: ['system_settings:write'] })
 *   configure() {}
 *
 *   // Any one of two scopes (the handler narrows by which one is held)
 *   @Auth({ anyPermissions: ['broadcasts:read', 'org_broadcasts:read'] })
 *   listBroadcasts() {}
 * }
 * ```
 *
 * @param options - the system roles (any of), permissions (all of) and
 *   `anyPermissions` (at least one of) required.
 * @returns the composed guards, metadata and OpenAPI decorators.
 *
 * @stability stable
 */
export function Auth(options: AuthOptions = {}) {
  const roles = options.roles ?? [];
  const permissions = options.permissions ?? [];
  const anyPermissions = options.anyPermissions ?? [];

  const rbac: RbacExtension = {
    authenticated: true,
    roles: [...roles],
    permissions: [...permissions],
    ...(anyPermissions.length > 0 ? { anyPermissions: [...anyPermissions] } : {}),
  };

  const decorators = [
    UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard),
    ApiBearerAuth(SESSION_SCHEME),
    ApiExtension(RBAC_EXTENSION_KEY, rbac),
    ApiUnauthorizedResponse({
      description: 'Unauthorized - Invalid or missing token',
      type: ErrorDto,
    }),
    ApiForbiddenResponse({
      description: 'Forbidden - Insufficient permissions',
      type: ErrorDto,
    }),
  ];

  if (roles.length > 0) {
    decorators.push(Roles(...roles));
  }

  if (permissions.length > 0) {
    decorators.push(Permissions(...permissions));
  }

  if (anyPermissions.length > 0) {
    decorators.push(AnyPermissions(...anyPermissions));
  }

  return applyDecorators(...decorators);
}
