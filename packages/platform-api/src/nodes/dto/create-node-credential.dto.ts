// =============================================================================
// The create-credential request body (issue #267, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/nodes` since #734 (`schemas.ts`, section
// "From create-node-credential.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import {
  MAX_NODE_CREDENTIAL_DAYS,
  createNodeCredentialSchema,
} from '@marinoscar/platform-contract/nodes';

// The wire schemas live in @marinoscar/platform-contract/nodes since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  MAX_NODE_CREDENTIAL_DAYS,
  createNodeCredentialSchema,
};

export class CreateNodeCredentialDto extends createZodDto(createNodeCredentialSchema) {}
