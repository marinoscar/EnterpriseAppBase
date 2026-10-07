// `@marinoscar/platform-contract/sharing`: the wire shapes of the sharing
// routes (issue #728, PP-7.1): groups, their members and their invites. The
// API's sharing slice wraps the schemas as its nestjs-zod DTOs. constants.ts is
// zod-free. Documented in
// ./README.md. Explicit named exports only.

export { GROUP_INVITE_STATUSES, GROUP_ROLES, SHARING_LIMITS } from './constants.js';
export type { GroupInviteStatus, GroupRole } from './constants.js';
export {
  addGroupMemberSchema,
  createGroupInviteSchema,
  createGroupSchema,
  groupEmailSchema,
  groupInviteListQuerySchema,
  groupInviteListSchema,
  groupInviteSchema,
  groupListQuerySchema,
  groupListSchema,
  groupMemberListSchema,
  groupMemberSchema,
  groupMembershipSchema,
  groupMetadataSchema,
  groupRoleSchema,
  groupSchema,
  myGroupInviteListSchema,
  myGroupInviteSchema,
  pageQuerySchema,
  updateGroupMemberSchema,
  updateGroupSchema,
} from './schemas.js';
export type {
  AddGroupMemberInput,
  CreateGroupInput,
  CreateGroupInviteInput,
  GroupDto,
  GroupInviteDto,
  GroupInviteList,
  GroupInviteListQuery,
  GroupList,
  GroupListQuery,
  GroupMemberDto,
  GroupMemberList,
  GroupMembershipDto,
  MyGroupInviteDto,
  MyGroupInviteList,
  PageQuery,
  UpdateGroupInput,
  UpdateGroupMemberInput,
} from './schemas.js';
