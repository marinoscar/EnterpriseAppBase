// =============================================================================
// The admin fleet's Swagger classes stay bound to their contract schemas (#881)
// =============================================================================
//
// The response classes keep their `@ApiProperty` decorators (the generated
// OpenAPI document is byte-identical to before the contract schemas existed),
// so the bind is two-fold: the compile-time `implements` on each class, and
// this spec, which proves the other direction at runtime: every key of the
// contract schema is a documented Swagger property of the class, and the
// class documents nothing the schema lacks.
// =============================================================================

import {
  adminNodeCredentialSchema,
  adminNodeSchema,
  nodeCredentialCreatedSchema,
  nodeCredentialListItemSchema,
  nodeJobCountsSchema,
  nodeOwnerSchema,
  nodeVitalsCountersSchema,
  nodeVitalsSchema,
} from '@marinoscar/platform-contract/nodes';
import type { z } from 'zod';

import {
  AdminNodeCredentialDto,
  AdminNodeDto,
  NodeJobCountsDto,
  NodeOwnerDto,
  NodeVitalsCountersDto,
  NodeVitalsDto,
} from './node-admin.dto';
import { NodeCredentialCreatedResponseDto, NodeCredentialListItemDto } from './node-credential-response.dto';

// `DECORATORS.API_MODEL_PROPERTIES_ARRAY` of `@nestjs/swagger`, which does not export it.
const API_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray';

function documentedProperties(cls: new () => unknown): string[] {
  const keys = Reflect.getMetadata(API_MODEL_PROPERTIES_ARRAY, cls.prototype) as string[];
  return keys.map((key) => key.replace(/^:/, '')).sort();
}

function schemaKeys(schema: z.ZodObject): string[] {
  return Object.keys(schema.shape).sort();
}

describe('admin fleet DTOs match the contract schemas', () => {
  it.each([
    ['NodeOwnerDto', NodeOwnerDto, nodeOwnerSchema],
    ['NodeJobCountsDto', NodeJobCountsDto, nodeJobCountsSchema],
    ['NodeVitalsCountersDto', NodeVitalsCountersDto, nodeVitalsCountersSchema],
    ['NodeVitalsDto', NodeVitalsDto, nodeVitalsSchema],
    ['AdminNodeDto', AdminNodeDto, adminNodeSchema],
    ['AdminNodeCredentialDto', AdminNodeCredentialDto, adminNodeCredentialSchema],
    ['NodeCredentialListItemDto', NodeCredentialListItemDto, nodeCredentialListItemSchema],
    ['NodeCredentialCreatedResponseDto', NodeCredentialCreatedResponseDto, nodeCredentialCreatedSchema],
  ] as const)('%s documents exactly the schema keys', (_name, cls, schema) => {
    expect(documentedProperties(cls)).toEqual(schemaKeys(schema as unknown as z.ZodObject));
  });

  it('keeps `token` off every list shape and on the create response only', () => {
    expect(documentedProperties(NodeCredentialListItemDto)).not.toContain('token');
    expect(documentedProperties(AdminNodeCredentialDto)).not.toContain('token');
    expect(documentedProperties(NodeCredentialCreatedResponseDto)).toContain('token');
  });
});
