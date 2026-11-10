---
"@marinoscar/platform-web": minor
---

Add the sharing UI (#731): `@marinoscar/platform-web/sharing/headless` (the sharing client, `useGroups`, `useGroup`, `useGroupActions`, `useGroupMembers`, `useGroupInvites`, `useMyGroupInvites`, `useGrants`, `useShareActions`, `useLinkGrants`, `useSharedWithMe`, `usePublicLink` and the `registerLinkRenderer` registry) and `@marinoscar/platform-web/sharing/ui` (`ShareDialog`, `GroupsPage`, `GroupDetailPage`, `PendingGroupInvites`, `SharedWithMeList`, `PublicLinkPage` and the `groupsSettingsPage` descriptor). `PlatformRequestOptions` gains `headers` (a page's extra request headers, such as `x-link-token`), and the test host records them and takes an error's `details`.
