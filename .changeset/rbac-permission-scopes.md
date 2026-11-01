---
"@marinoscar/platform-api": minor
---

`TelemetryPermissionDeclaration` gains a required `scope: 'system' | 'org'` field, and the three telemetry permissions declare `scope: 'system'` (#723): an app's permission registry now refuses a declaration without a scope, and refuses a default grant to a role of the other scope.
