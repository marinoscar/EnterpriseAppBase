// =============================================================================
// The claim token, as a node quotes it back (issue #364, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/nodes` since #734 (`schemas.ts`, section
// "From claim-token.field.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import {
  claimTokenField,
} from '@marinoscar/platform-contract/nodes';

// The wire schemas live in @marinoscar/platform-contract/nodes since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  claimTokenField,
};
