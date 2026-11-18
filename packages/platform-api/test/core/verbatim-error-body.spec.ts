import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

import { hasVerbatimErrorBody, withVerbatimErrorBody } from '../../src/core';

/**
 * The verbatim-body brand (issue #153), pinned on its own now that it is a
 * published export of `@marinoscar/platform-api/core` (issue #698). The
 * filter's handling of a branded exception is covered by
 * http-exception.filter.spec.ts; this file pins the brand itself.
 */
describe('withVerbatimErrorBody / hasVerbatimErrorBody', () => {
  it('returns the same instance, so the class and the status are untouched', () => {
    const exception = new BadRequestException({ error: 'slow_down' });

    const branded = withVerbatimErrorBody(exception);

    expect(branded).toBe(exception);
    expect(branded).toBeInstanceOf(BadRequestException);
    expect(branded.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(branded.getResponse()).toEqual({ error: 'slow_down' });
  });

  it('reports a branded HttpException and nothing else', () => {
    expect(hasVerbatimErrorBody(withVerbatimErrorBody(new HttpException({ error: 'x' }, 401)))).toBe(true);

    expect(hasVerbatimErrorBody(new BadRequestException({ error: 'x' }))).toBe(false);
    expect(hasVerbatimErrorBody(new Error('plain'))).toBe(false);
    expect(hasVerbatimErrorBody({ error: 'x' })).toBe(false);
    expect(hasVerbatimErrorBody(undefined)).toBe(false);
    expect(hasVerbatimErrorBody(null)).toBe(false);
  });

  it('keeps the brand out of anything that walks own enumerable properties', () => {
    const branded = withVerbatimErrorBody(new BadRequestException({ error: 'x' }));

    expect(Object.keys(branded)).toEqual(Object.keys(new BadRequestException({ error: 'x' })));
    expect(JSON.stringify(branded)).toBe(JSON.stringify(new BadRequestException({ error: 'x' })));
  });

  it('cannot be removed or overwritten once set', () => {
    const branded = withVerbatimErrorBody(new BadRequestException({ error: 'x' }));
    const brand = Object.getOwnPropertySymbols(branded)[0];

    expect(Object.getOwnPropertyDescriptor(branded, brand)).toEqual({
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  });

  it('is recognised across two copies of the module (Symbol.for, not Symbol)', () => {
    let otherCopy: typeof import('../../src/core/errors/verbatim-error-body.exception') | undefined;
    // A second copy of this module, sharing the one @nestjs/common (as two
    // copies of the module in one process would): only the brand's symbol
    // can differ between the copies.
    const nest = jest.requireActual('@nestjs/common');
    jest.isolateModules(() => {
      jest.doMock('@nestjs/common', () => nest);
      otherCopy = require('../../src/core/errors/verbatim-error-body.exception');
    });

    expect(otherCopy).toBeDefined();
    expect(otherCopy!.withVerbatimErrorBody).not.toBe(withVerbatimErrorBody);
    expect(otherCopy!.hasVerbatimErrorBody(withVerbatimErrorBody(new BadRequestException({ error: 'x' })))).toBe(true);
  });
});
