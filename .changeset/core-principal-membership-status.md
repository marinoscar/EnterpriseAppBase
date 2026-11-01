---
"@marinoscar/platform-api": minor
---

`OrgMembership` gains an optional `status` (`'active' | 'suspended'`, absent means active), so a principal can list every organisation the user belongs to, suspended ones included (#724).
