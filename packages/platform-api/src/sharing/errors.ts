// =============================================================================
// The refusals of the group and grant routes, as `details.reason` values
// (issues #728, #729)
// =============================================================================
//
// Clients branch on `details.reason`, never on `message` (docs/API.md). The
// reasons are part of the public contract once released.
// =============================================================================

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Every `details.reason` the group and grant routes answer with.
 *
 * @stability experimental
 */
export const SHARING_ERROR_REASONS: {
  /** 409: the group still owns registered resources; `details.counts` per resource type. */
  readonly GROUP_OWNS_RESOURCES: 'GROUP_OWNS_RESOURCES';
  /** 409: the change would leave the group without an `admin`. */
  readonly LAST_GROUP_ADMIN: 'LAST_GROUP_ADMIN';
  /** 422: the person is not a member of (nor invited to) the group's organization. */
  readonly NOT_AN_ORG_MEMBER: 'NOT_AN_ORG_MEMBER';
  /** 409: the person is already a member of the group. */
  readonly ALREADY_A_MEMBER: 'ALREADY_A_MEMBER';
  /** 409: the address already has a pending invite to the group. */
  readonly INVITE_PENDING: 'INVITE_PENDING';
  /** 409: the invite is no longer pending (accepted, declined or revoked). */
  readonly INVITE_NOT_PENDING: 'INVITE_NOT_PENDING';
  /** 410: the invite expired. */
  readonly INVITE_EXPIRED: 'INVITE_EXPIRED';
  /** 409: the group has `maxMembersPerGroup` members. */
  readonly GROUP_FULL: 'GROUP_FULL';
  /** 409: the caller created `maxGroupsPerCreator` groups in this organization. */
  readonly GROUP_LIMIT_REACHED: 'GROUP_LIMIT_REACHED';
  /** 409: `If-Match` names a version that is no longer current. */
  readonly VERSION_CONFLICT: 'VERSION_CONFLICT';
  /** 429: too many failed member lookups by e-mail; `details.retryAfterMs`. */
  readonly LOOKUP_THROTTLED: 'LOOKUP_THROTTLED';
  /** 403: the action also needs an RBAC permission the caller lacks; `details.permission` (#729). */
  readonly MISSING_PERMISSION: 'MISSING_PERMISSION';
  /** 400: a grant to yourself (#729). */
  readonly SELF_GRANT: 'SELF_GRANT';
  /** 422: the role is not grantable to that kind of grantee for the resource type; `details.grantable` (#729). */
  readonly ROLE_NOT_GRANTABLE: 'ROLE_NOT_GRANTABLE';
  /** 422: the group is not a group of the record's organization (#729). */
  readonly GROUP_NOT_IN_ORG: 'GROUP_NOT_IN_ORG';
  /** 409: the record has `maxGrantsPerResource` active grants (#729). */
  readonly GRANT_LIMIT_REACHED: 'GRANT_LIMIT_REACHED';
  /** 400: `expiresAt` is not in the future (#729). */
  readonly EXPIRY_IN_PAST: 'EXPIRY_IN_PAST';
} = {
  GROUP_OWNS_RESOURCES: 'GROUP_OWNS_RESOURCES',
  LAST_GROUP_ADMIN: 'LAST_GROUP_ADMIN',
  NOT_AN_ORG_MEMBER: 'NOT_AN_ORG_MEMBER',
  ALREADY_A_MEMBER: 'ALREADY_A_MEMBER',
  INVITE_PENDING: 'INVITE_PENDING',
  INVITE_NOT_PENDING: 'INVITE_NOT_PENDING',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  GROUP_FULL: 'GROUP_FULL',
  GROUP_LIMIT_REACHED: 'GROUP_LIMIT_REACHED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  LOOKUP_THROTTLED: 'LOOKUP_THROTTLED',
  MISSING_PERMISSION: 'MISSING_PERMISSION',
  SELF_GRANT: 'SELF_GRANT',
  ROLE_NOT_GRANTABLE: 'ROLE_NOT_GRANTABLE',
  GROUP_NOT_IN_ORG: 'GROUP_NOT_IN_ORG',
  GRANT_LIMIT_REACHED: 'GRANT_LIMIT_REACHED',
  EXPIRY_IN_PAST: 'EXPIRY_IN_PAST',
};

/** The 404 for a group the caller may not see: the same body whether it exists or not. */
export function groupNotFound(): NotFoundException {
  return new NotFoundException('Group not found');
}

/** The 404 for an invite that does not exist, is not the caller's, or is no longer pending. */
export function inviteNotFound(): NotFoundException {
  return new NotFoundException('Invitation not found');
}

/** The 404 for a member that is not in the group. */
export function memberNotFound(): NotFoundException {
  return new NotFoundException('Member not found');
}

/** The 403 for a member whose group role is too low for the action. */
export function groupAdminRequired(): ForbiddenException {
  return new ForbiddenException('Only an admin of this group can do this');
}

/** The 403 for a caller with no active organization. */
export function noActiveOrganization(): ForbiddenException {
  return new ForbiddenException('This credential is not bound to an organization');
}

/** The 409 refusing to leave a group without an admin. */
export function lastGroupAdmin(): ConflictException {
  return new ConflictException({
    message: 'This would leave the group without an admin. Make another member an admin first.',
    details: { reason: SHARING_ERROR_REASONS.LAST_GROUP_ADMIN },
  });
}

/** The 409 refusing to delete a group that still owns resources. */
export function groupOwnsResources(counts: Record<string, number>): ConflictException {
  return new ConflictException({
    message: 'The group still owns resources. Move or delete them first.',
    details: { reason: SHARING_ERROR_REASONS.GROUP_OWNS_RESOURCES, counts },
  });
}

/** A 409 with a reason. */
export function conflict(reason: string, message: string): ConflictException {
  return new ConflictException({ message, details: { reason } });
}

/** The 422 for a person outside the group's organization. */
export function notAnOrgMember(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    message: 'That person is not a member of this organization',
    details: { reason: SHARING_ERROR_REASONS.NOT_AN_ORG_MEMBER },
  });
}

/** The 410 for an expired invite. */
export function inviteExpired(): GoneException {
  return new GoneException({
    message: 'This invitation has expired. Ask a group admin to invite you again.',
    details: { reason: SHARING_ERROR_REASONS.INVITE_EXPIRED },
  });
}

/** The 429 for too many failed lookups; the error filter turns `retryAfterMs` into `Retry-After`. */
export function lookupThrottled(retryAfterMs: number): HttpException {
  return new HttpException(
    {
      message: 'Too many lookups of unknown addresses. Try again later.',
      details: { reason: SHARING_ERROR_REASONS.LOOKUP_THROTTLED, retryAfterMs },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

// ---- access decisions and grants (#729) --------------------------------------------

/**
 * The 404 of a record the caller may not see (a `denyAs: 'not_found'` type):
 * the SAME body whether the record exists or not, so an id discloses nothing.
 */
export function resourceNotFound(): NotFoundException {
  return new NotFoundException('Resource not found');
}

/** The 403 of a record the caller may not act on (a `denyAs: 'forbidden'` type). */
export function resourceForbidden(): ForbiddenException {
  return new ForbiddenException('You do not have access to this resource');
}

/**
 * The 403 of an action that also needs an RBAC permission the caller lacks:
 * an authorization failure, not a sharing one, so it names the permission
 * (as kvox's `assertWritePermission` does), even for the owner.
 */
export function missingPermission(permission: string): ForbiddenException {
  return new ForbiddenException({
    message: `Missing permission: ${permission}`,
    details: { reason: SHARING_ERROR_REASONS.MISSING_PERMISSION, permission },
  });
}

/** The 404 of a grant that does not exist, is revoked, or that the caller may not manage. */
export function grantNotFound(): NotFoundException {
  return new NotFoundException('Grant not found');
}

/** The 400 refusing a grant to yourself. */
export function selfGrant(): BadRequestException {
  return new BadRequestException({ message: 'You cannot share a record with yourself', details: { reason: SHARING_ERROR_REASONS.SELF_GRANT } });
}

/** The 422 of a role the resource type does not grant to that kind of grantee. */
export function roleNotGrantable(role: string, kind: string, grantable: readonly string[]): UnprocessableEntityException {
  return new UnprocessableEntityException({
    message: `The role "${role}" cannot be granted to a ${kind} on this resource type`,
    details: { reason: SHARING_ERROR_REASONS.ROLE_NOT_GRANTABLE, grantable: [...grantable] },
  });
}

/** The 422 of a group that is not a group of the record's organization. */
export function groupNotInOrg(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    message: 'That group is not a group of this organization',
    details: { reason: SHARING_ERROR_REASONS.GROUP_NOT_IN_ORG },
  });
}

/** The 400 of an expiry that is not in the future. */
export function expiryInPast(): BadRequestException {
  return new BadRequestException({ message: 'expiresAt must be in the future', details: { reason: SHARING_ERROR_REASONS.EXPIRY_IN_PAST } });
}
