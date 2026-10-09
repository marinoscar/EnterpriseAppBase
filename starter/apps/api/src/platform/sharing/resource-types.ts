// The app's shareable resource types. Making a table shareable is one
// `registerResourceType` call (roles, the minimum role per action, ownership,
// `loadOwners`), made at import time before bootstrap; sharing itself then
// needs no further code (`POST /api/grants`, the web `ShareDialog`).
//
// None ships here: the sample `Note` is personal to one user and carries no
// organization, while a shareable record belongs to an organization (its grants
// are row-level-security rows of that org). The tested walk-through, with a
// user-owned and a group-owned type, a controller using `AccessPolicy` and the
// delete rule, is the sharing README's "Minimal examples":
// https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/sharing/README.md#minimal-examples
//
// Add yours to this array; `sharing.slice.ts` registers each when the slice is on.
import type { ResourceTypeDef } from '@marinoscar/platform-api/sharing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a type's role union is its own
export const APP_RESOURCE_TYPES: readonly ResourceTypeDef<any>[] = [];
