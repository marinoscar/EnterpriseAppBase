// `@marinoscar/platform-web/sharing/headless`: the sharing hooks, client and
// link-renderer registry, with no component (issue #731, PP-7.4). Documented
// in ../README.md.

export type { ResourceRef, SharingError, SharingResource, SharingRoleOption } from './types.js';
export { describeRetryAfter, isSharingError, toSharingError } from './errors.js';
export { createSharingClient } from './client.js';
export type {
  CreateLinkInput,
  IssuedLinkGrant,
  ShareTarget,
  SharingClient,
  SharingClientPaths,
  SharingPageQuery,
} from './client.js';
export { useGroup, useGroupActions, useGroups } from './useGroups.js';
export type { GroupActions, UseGroupsOptions } from './useGroups.js';
export { useGroupMembers } from './useGroupMembers.js';
export { useGroupInvites, useMyGroupInvites } from './useGroupInvites.js';
export { useGrants, useShareActions } from './useGrants.js';
export type { ShareActions } from './useGrants.js';
export { useLinkGrants } from './useLinkGrants.js';
export type { UseLinkGrantsReturn } from './useLinkGrants.js';
export { useSharedWithMe } from './useSharedWithMe.js';
export { parseLinkTokenFromHash, usePublicLink } from './usePublicLink.js';
export type { PublicLinkStatus, UsePublicLinkOptions, UsePublicLinkReturn } from './usePublicLink.js';
export {
  LinkRendererRegistry,
  LinkRendererRegistryError,
  freezeLinkRenderers,
  linkRenderers,
  registerLinkRenderer,
} from './linkRenderers.js';
export type { LinkRenderer, LinkRendererProps, LinkRendererRegistryErrorCode } from './linkRenderers.js';
