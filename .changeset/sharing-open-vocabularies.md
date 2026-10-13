---
'@marinoscar/platform-api': minor
'@marinoscar/platform-web': minor
'@marinoscar/platform-contract': minor
'@marinoscar/platform-db': minor
---

Sharing: open group roles and persisted app grantee kinds. Migration `0037_open_sharing_vocabularies` turns `group_members.role`, `group_invites.role` and `grants.grantee_kind` from Prisma enums into text, adds the nullable `grants.grantee_ref` and relaxes `grants_grantee_consistency_check`; an app registers a group role with `registerGroupRole` and a persisted grantee kind with `registerGranteeKind({ persisted: true })`, and the share dialog and member role pickers read the registries.
