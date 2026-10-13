import { ArgumentsHost, ConflictException, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { errorCodeRegistry } from '../../src/core/errors/error-codes';
import { HttpExceptionFilter } from '../../src/core/errors/http-exception.filter';
import { withTemporaryEntries } from '../../src/core/registry/testing';
import { withVerbatimErrorBody } from '../../src/core/errors/verbatim-error-body.exception';
import { DatabaseSeedException } from '../../src/core/errors/database-seed.exception';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The closed `code` enum published by `src/core/errors/error.dto.ts`. Kept as a
 * literal copy here (rather than importing the DTO) so this spec pins the
 * WIRE CONTRACT independently of whatever the DTO file happens to say —
 * if someone edits the enum without meaning to change the contract, this
 * list has to be edited too, which is the point.
 */
const PUBLISHED_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'UNPROCESSABLE_ENTITY',
  'TOO_MANY_REQUESTS',
  'INTERNAL_ERROR',
  'ERROR',
];

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpExceptionFilter();

    // Mock Fastify response object
    mockResponse = {
      code: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      url: '/api/test',
      method: 'GET',
    };

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as ArgumentsHost;
  });

  describe('HttpException handling', () => {
    it('should format HttpException with proper status code and message', () => {
      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(400);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'BAD_REQUEST',
          message: 'Test error',
        }),
      );
    });

    it('should handle 400 Bad Request with validation errors', () => {
      const validationErrors = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Password too short' },
      ];
      const exception = new HttpException(
        {
          message: 'Validation failed',
          details: validationErrors,
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(400);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'BAD_REQUEST',
          message: 'Validation failed',
          details: validationErrors,
        }),
      );
    });

    it('should handle 401 Unauthorized', () => {
      const exception = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(401);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        }),
      );
    });

    it('should handle 403 Forbidden', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(403);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Forbidden',
        }),
      );
    });

    it('should handle 404 Not Found', () => {
      const exception = new HttpException('Resource not found', HttpStatus.NOT_FOUND);

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(404);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Resource not found',
        }),
      );
    });

    it('should handle 409 Conflict', () => {
      const exception = new HttpException('Resource already exists', HttpStatus.CONFLICT);

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(409);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Resource already exists',
        }),
      );
    });

    it('should handle 412 Precondition Failed', () => {
      const exception = new HttpException(
        'Version mismatch',
        HttpStatus.PRECONDITION_FAILED,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(412);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 412,
          code: 'PRECONDITION_FAILED',
          message: 'Version mismatch',
        }),
      );
    });

    it('should handle 500 Internal Server Error', () => {
      const exception = new HttpException(
        'Internal error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'Internal error',
        }),
      );
    });
  });

  describe('Error response structure', () => {
    it('should include timestamp in error response', () => {
      const exception = new HttpException('Test', HttpStatus.BAD_REQUEST);
      const beforeTime = new Date().toISOString();

      filter.catch(exception, mockHost);

      const response = mockResponse.send.mock.calls[0][0];
      expect(response.timestamp).toBeDefined();
      expect(new Date(response.timestamp)).toBeInstanceOf(Date);
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include request path in error response', () => {
      const exception = new HttpException('Test', HttpStatus.BAD_REQUEST);
      mockRequest.url = '/api/users/123';

      filter.catch(exception, mockHost);

      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/users/123',
        }),
      );
    });

    it('should handle exceptions with error array (validation errors)', () => {
      const errors = [
        { property: 'email', constraints: { isEmail: 'email must be an email' } },
        { property: 'age', constraints: { min: 'age must be >= 18' } },
      ];
      const exception = new HttpException(
        {
          message: 'Validation failed',
          details: errors,
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Validation failed',
          details: errors,
        }),
      );
    });

    it('should not include details field when no details provided', () => {
      const exception = new HttpException('Simple error', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      const response = mockResponse.send.mock.calls[0][0];
      expect(response.details).toBeUndefined();
    });
  });

  describe('Generic Error handling', () => {
    it('should handle generic Error objects (non-HttpException)', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Something went wrong');

      filter.catch(error, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong',
          details: expect.stringContaining('Error: Something went wrong'),
        }),
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should not expose stack traces in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Something went wrong');

      filter.catch(error, mockHost);

      const response = mockResponse.send.mock.calls[0][0];
      expect(response.details).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle unknown exception types', () => {
      const unknownError = { some: 'unknown error' };

      filter.catch(unknownError, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        }),
      );
    });
  });

  describe('Error code mapping', () => {
    it('should map 422 to UNPROCESSABLE_ENTITY', () => {
      const exception = new HttpException('Invalid data', HttpStatus.UNPROCESSABLE_ENTITY);

      filter.catch(exception, mockHost);

      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNPROCESSABLE_ENTITY',
        }),
      );
    });

    it('should map 429 to TOO_MANY_REQUESTS', () => {
      const exception = new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);

      filter.catch(exception, mockHost);

      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TOO_MANY_REQUESTS',
        }),
      );
    });

    it('should default to ERROR for unmapped status codes', () => {
      const exception = new HttpException('Service unavailable', HttpStatus.SERVICE_UNAVAILABLE);

      filter.catch(exception, mockHost);

      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 503,
          code: 'ERROR',
        }),
      );
    });
  });

  describe('String vs Object response handling', () => {
    it('should handle string exception response', () => {
      const exception = new HttpException('Simple string message', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Simple string message',
        }),
      );
    });

    it('should handle object exception response with custom code', () => {
      const exception = new HttpException(
        {
          code: 'CUSTOM_CODE',
          message: 'Custom error',
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      // Note: The filter overrides custom code with standard code mapping
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Custom error',
        }),
      );
    });
  });

  describe('Verbatim error body opt-out (#153)', () => {
    it('sends a branded exception body exactly as thrown, with no envelope keys', () => {
      const exception = withVerbatimErrorBody(
        new HttpException(
          { error: 'authorization_pending', error_description: 'still waiting' },
          HttpStatus.BAD_REQUEST,
        ),
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(400);
      expect(mockResponse.send).toHaveBeenCalledWith({
        error: 'authorization_pending',
        error_description: 'still waiting',
      });

      const response = mockResponse.send.mock.calls[0][0];
      expect(response).not.toHaveProperty('statusCode');
      expect(response).not.toHaveProperty('code');
      expect(response).not.toHaveProperty('timestamp');
      expect(response).not.toHaveProperty('path');
    });

    it('falls through to the normal envelope when the branded payload is a string, not an object', () => {
      // The object guard in the filter matters: a string payload has
      // nothing to send verbatim, so a branded exception constructed with a
      // string must NOT put a bare JSON string on the wire — it should fall
      // back to the ordinary enveloped response.
      const exception = withVerbatimErrorBody(
        new HttpException('a plain string payload', HttpStatus.BAD_REQUEST),
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(400);
      const response = mockResponse.send.mock.calls[0][0];

      expect(response).toMatchObject({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'a plain string payload',
      });
      expect(response).toHaveProperty('timestamp');
      expect(response).toHaveProperty('path');
      // Definitely not a bare string sent as the body.
      expect(typeof response).toBe('object');
    });
  });

  describe('DatabaseSeedException (#153)', () => {
    it('overwrites the constructor-supplied code with the status-derived code, and keeps it a published value', () => {
      const exception = new DatabaseSeedException(
        'Role "default"',
        'npm run prisma:seed',
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(500);

      const response = mockResponse.send.mock.calls[0][0];

      // DatabaseSeedException's constructor passes `code:
      // 'DATABASE_SEED_REQUIRED'` in its payload, but the filter always
      // derives `code` from the HTTP status and ignores it — so the value
      // on the wire is the status-derived one, not the one the exception
      // asked for.
      expect(response.code).not.toBe('DATABASE_SEED_REQUIRED');
      expect(response.code).toBe('INTERNAL_ERROR');

      // And whatever the filter produces must stay inside the closed enum
      // `src/core/errors/error.dto.ts` publishes as the API's error contract.
      expect(PUBLISHED_ERROR_CODES).toContain(response.code);

      // The identifying data DatabaseSeedException wanted to surface is
      // still reachable, just under `details` rather than `code`.
      expect(response.details).toMatchObject({
        missingData: 'Role "default"',
        seedCommand: 'npm run prisma:seed',
      });
    });
  });

  describe('ZodValidationException (global ZodValidationPipe)', () => {
    it('names each failing field under details.issues without echoing the value', () => {
      const schema = z
        .object({ readings: z.array(z.object({ unit: z.enum(['kg', 'lb']) })) })
        .strict();
      const result = schema.safeParse({ readings: [{ unit: 'secret-stone' }], origin: 'ai' });
      expect(result.success).toBe(false);

      filter.catch(new ZodValidationException(result.error), mockHost);

      expect(mockResponse.code).toHaveBeenCalledWith(400);
      const body = mockResponse.send.mock.calls[0][0];
      expect(body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', message: 'Validation failed' });
      expect(body.details.issues.map((issue: { path: string }) => issue.path).sort()).toEqual([
        '',
        'readings.0.unit',
      ]);
      expect(JSON.stringify(body)).not.toContain('secret-stone');
    });

    it('keeps explicit details a thrown exception already carries', () => {
      const exception = new HttpException(
        { message: 'Validation failed', details: { field: 'x' } },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.send.mock.calls[0][0].details).toEqual({ field: 'x' });
    });
  });
});

// =============================================================================
// PP-14.14: registered payload codes and foreign-error mappers
// =============================================================================

describe('HttpExceptionFilter: registered codes and error mappers (PP-14.14)', () => {
  let response: { code: jest.Mock; header: jest.Mock; send: jest.Mock };
  let host: ArgumentsHost;
  const sent = () => response.send.mock.calls[0][0];

  beforeEach(() => {
    response = { code: jest.fn().mockReturnThis(), header: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };
    host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ url: '/api/test', method: 'GET' }) }),
    } as ArgumentsHost;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const NOTE_TITLE_TAKEN = { code: 'NOTE_TITLE_TAKEN', status: 409, description: 'A note with this title exists.' };

  it('passes a payload code through when it is registered for the exception\'s status', async () => {
    await withTemporaryEntries(errorCodeRegistry, [NOTE_TITLE_TAKEN], () => {
      new HttpExceptionFilter().catch(new ConflictException({ code: 'NOTE_TITLE_TAKEN', message: 'Title used', details: { field: 'title' } }), host);
    });
    expect(response.code).toHaveBeenCalledWith(409);
    expect(sent()).toMatchObject({ statusCode: 409, code: 'NOTE_TITLE_TAKEN', message: 'Title used', details: { field: 'title' } });
  });

  it('ignores a registered code on the wrong status, and an unregistered one (derived from the status as before)', async () => {
    await withTemporaryEntries(errorCodeRegistry, [NOTE_TITLE_TAKEN], () => {
      new HttpExceptionFilter().catch(new NotFoundException({ code: 'NOTE_TITLE_TAKEN', message: 'Missing' }), host);
      new HttpExceptionFilter().catch(new ConflictException({ code: 'NOT_REGISTERED_ANYWHERE', message: 'x' }), host);
      new HttpExceptionFilter().catch(new ConflictException({ code: 7, message: 'x' }), host);
    });
    expect(response.send.mock.calls.map(([body]) => body.code)).toEqual(['NOT_FOUND', 'CONFLICT', 'CONFLICT']);
  });

  it('without a registration DatabaseSeedException-style codes stay ignored', () => {
    new HttpExceptionFilter().catch(new HttpException({ code: 'DATABASE_SEED_REQUIRED', message: 'seed' }, 500), host);
    expect(sent().code).toBe('INTERNAL_ERROR');
  });

  describe('mappers', () => {
    class DriverError extends Error {
      constructor(readonly driverCode: string) {
        super('relation "users" violates constraint on host db-7 password=hunter2');
      }
    }
    const uniqueMapper = (error: unknown) =>
      error instanceof DriverError && error.driverCode === 'P2002'
        ? new ConflictException({ message: 'Already exists', details: { fields: ['email'] } })
        : null;

    it('renders a mapped foreign error as the mapper\'s exception, never with the original message', () => {
      new HttpExceptionFilter({ mappers: [uniqueMapper] }).catch(new DriverError('P2002'), host);
      expect(response.code).toHaveBeenCalledWith(409);
      const body = sent();
      expect(body).toMatchObject({ statusCode: 409, code: 'CONFLICT', message: 'Already exists', details: { fields: ['email'] } });
      expect(JSON.stringify(body)).not.toMatch(/hunter2|db-7|violates/);
    });

    it('logs the ORIGINAL error server-side for a mapped 5xx', () => {
      const error = jest.spyOn(Logger.prototype, 'error');
      const original = new DriverError('boom');
      new HttpExceptionFilter({ mappers: [() => new HttpException({ message: 'Upstream unavailable' }, 502)] }).catch(original, host);
      expect(sent()).toMatchObject({ statusCode: 502, code: 'ERROR', message: 'Upstream unavailable' });
      expect(error).toHaveBeenCalledWith(expect.stringContaining('502'), original.stack);
    });

    it('an unmapped foreign error keeps the pre-existing 500 behaviour', () => {
      new HttpExceptionFilter({ mappers: [uniqueMapper] }).catch(new DriverError('other'), host);
      expect(sent()).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });

    it('never offers an HttpException to a mapper (built-in responses cannot be rewritten)', () => {
      const mapper = jest.fn(() => new ConflictException('hijacked'));
      new HttpExceptionFilter({ mappers: [mapper] }).catch(new NotFoundException('Missing'), host);
      expect(mapper).not.toHaveBeenCalled();
      expect(sent()).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Missing' });
    });

    it('the first mapper to answer wins; a throwing mapper and a non-exception result are skipped', () => {
      const second = jest.fn(() => new ConflictException('second'));
      new HttpExceptionFilter({
        mappers: [
          () => {
            throw new Error('mapper bug');
          },
          (() => ({ status: 409 })) as never,
          () => null,
          () => new NotFoundException('first'),
          second,
        ],
      }).catch(new DriverError('x'), host);
      expect(sent()).toMatchObject({ statusCode: 404, message: 'first' });
      expect(second).not.toHaveBeenCalled();
    });

    it('a mapper cannot smuggle a code that is not registered for its status', () => {
      new HttpExceptionFilter({ mappers: [() => new ConflictException({ code: 'MADE_UP_CODE', message: 'x' })] }).catch(new DriverError('x'), host);
      expect(sent().code).toBe('CONFLICT');
    });

    it('a filter built without options maps nothing', () => {
      new HttpExceptionFilter().catch(new DriverError('P2002'), host);
      expect(sent()).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });
  });
});
