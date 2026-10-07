import { createZodDto } from 'nestjs-zod';
import {
  addGroupMemberSchema,
  createGroupInviteSchema,
  createGroupSchema,
  groupInviteListQuerySchema,
  groupInviteListSchema,
  groupInviteSchema,
  groupListQuerySchema,
  groupListSchema,
  groupMemberListSchema,
  groupMemberSchema,
  groupMembershipSchema,
  groupSchema,
  myGroupInviteListSchema,
  pageQuerySchema,
  updateGroupMemberSchema,
  updateGroupSchema,
} from '@marinoscar/platform-contract/sharing';

// =============================================================================
// The group routes' request and response DTOs (issue #728, PP-7.1)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/sharing`; this file wraps
// them as nestjs-zod DTOs: the global `ZodValidationPipe` parses every body
// and query with them, and the OpenAPI document is generated from them.
// =============================================================================

/**
 * `GET /api/groups` query.
 *
 * @stability experimental
 */
export class GroupListQueryDto extends createZodDto(groupListQuerySchema) {}
/**
 * A page query (`page`, `pageSize`).
 *
 * @stability experimental
 */
export class PageQueryDto extends createZodDto(pageQuerySchema) {}
/**
 * `POST /api/groups` body.
 *
 * @stability experimental
 */
export class CreateGroupDto extends createZodDto(createGroupSchema) {}
/**
 * `PATCH /api/groups/:id` body.
 *
 * @stability experimental
 */
export class UpdateGroupDto extends createZodDto(updateGroupSchema) {}
/**
 * One group.
 *
 * @stability experimental
 */
export class GroupResponseDto extends createZodDto(groupSchema) {}
/**
 * A page of groups.
 *
 * @stability experimental
 */
export class GroupListResponseDto extends createZodDto(groupListSchema) {}
/**
 * `POST /api/groups/:id/members` body.
 *
 * @stability experimental
 */
export class AddGroupMemberDto extends createZodDto(addGroupMemberSchema) {}
/**
 * `PATCH /api/groups/:id/members/:userId` body.
 *
 * @stability experimental
 */
export class UpdateGroupMemberDto extends createZodDto(updateGroupMemberSchema) {}
/**
 * One member.
 *
 * @stability experimental
 */
export class GroupMemberResponseDto extends createZodDto(groupMemberSchema) {}
/**
 * A page of members.
 *
 * @stability experimental
 */
export class GroupMemberListResponseDto extends createZodDto(groupMemberListSchema) {}
/**
 * `POST /api/groups/:id/invites` body.
 *
 * @stability experimental
 */
export class CreateGroupInviteDto extends createZodDto(createGroupInviteSchema) {}
/**
 * `GET /api/groups/:id/invites` query.
 *
 * @stability experimental
 */
export class GroupInviteListQueryDto extends createZodDto(groupInviteListQuerySchema) {}
/**
 * One invite.
 *
 * @stability experimental
 */
export class GroupInviteResponseDto extends createZodDto(groupInviteSchema) {}
/**
 * A page of invites.
 *
 * @stability experimental
 */
export class GroupInviteListResponseDto extends createZodDto(groupInviteListSchema) {}
/**
 * The caller's own pending invites.
 *
 * @stability experimental
 */
export class MyGroupInviteListResponseDto extends createZodDto(myGroupInviteListSchema) {}
/**
 * The membership an accepted invite produced.
 *
 * @stability experimental
 */
export class GroupMembershipResponseDto extends createZodDto(groupMembershipSchema) {}
