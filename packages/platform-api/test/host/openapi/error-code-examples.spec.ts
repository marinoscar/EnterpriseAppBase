import { errorCodeRegistry, withTemporaryEntries } from '../../../src/core/index';
import { enrichOpenApiDocument } from '../../../src/host/openapi/document';
import type { MutableDocument } from '../../../src/host/openapi/types';

// PP-14.14: ErrorDto.code is an open string; the document lists the registered codes as examples.
describe('ErrorDto.code in the OpenAPI document', () => {
  const documentWithErrorDto = (): MutableDocument => ({
    paths: {},
    components: { schemas: { ErrorDto: { type: 'object', properties: { code: { type: 'string', examples: ['stale'] } } } } },
  });
  const codeOf = (doc: MutableDocument) =>
    (doc.components as { schemas: { ErrorDto: { properties: { code: Record<string, unknown> } } } }).schemas.ErrorDto.properties.code;

  it('publishes the built-in codes, then the platform slices\' own, then the ERROR fallback as examples, with no enum', () => {
    const code = codeOf(enrichOpenApiDocument(documentWithErrorDto()));
    const examples = code.examples as string[];
    expect(code.type).toBe('string');
    expect(code.enum).toBeUndefined();
    expect(examples.slice(0, 10)).toEqual([
      'BAD_REQUEST',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'PRECONDITION_FAILED',
      'PAYLOAD_TOO_LARGE',
      'UNPROCESSABLE_ENTITY',
      'TOO_MANY_REQUESTS',
      'INTERNAL_ERROR',
    ]);
    // A slice registers the domain codes it throws when it is imported (the identity slice's `ROLE_NOT_ASSIGNABLE`).
    expect(examples.slice(10, -1)).toEqual(['ROLE_NOT_ASSIGNABLE']);
    expect(examples.at(-1)).toBe('ERROR');
  });

  it('adds the codes an app registered, before the fallback', async () => {
    await withTemporaryEntries(errorCodeRegistry, [{ code: 'NOTE_TITLE_TAKEN', status: 409, description: 'd' }], () => {
      const examples = codeOf(enrichOpenApiDocument(documentWithErrorDto())).examples as string[];
      expect(examples.slice(-2)).toEqual(['NOTE_TITLE_TAKEN', 'ERROR']);
    });
  });

  it('leaves a document without ErrorDto alone', () => {
    const doc: MutableDocument = { paths: {}, components: { schemas: {} } };
    expect(() => enrichOpenApiDocument(doc)).not.toThrow();
  });
});
