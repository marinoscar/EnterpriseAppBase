---
"@marinoscar/platform-api": minor
---

The sharing slice's conformance suite (#732): importing the new `@marinoscar/platform-api/sharing/testing` entry registers the `sharing` suite with `runPlatformConformance()`. Five checks against the consuming app: no source file touches the sharing tables directly (`prisma.grant`, `.group`, `.groupMember`, `.groupInvite`, or `grants`/`groups`/`group_members`/`group_invites` in raw SQL), every `owner_group_id` model maps to a registered group-owned resource type, every `@LinkGrantResource` route is behind `LinkGrantGuard` (declared, servable, deliberately public), the three partial unique indexes exist in the migration SQL, and the registered resource type ids equal the app's snapshot.
