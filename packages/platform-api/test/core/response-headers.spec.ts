import { BadRequestException } from '@nestjs/common';

import { HttpExceptionFilter, responseHeadersOf, withResponseHeaders } from '../../src/core/index';

describe('withResponseHeaders', () => {
  it('brands the same instance and keeps its class and status', () => {
    const exception = new BadRequestException('x');
    expect(withResponseHeaders(exception, { 'X-One': '1' })).toBe(exception);
    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getStatus()).toBe(400);
  });

  it('is non-enumerable, so it never reaches a serializer', () => {
    const exception = withResponseHeaders(new BadRequestException('x'), { 'X-One': '1' });
    expect(JSON.stringify(exception)).not.toContain('X-One');
    expect(Object.keys(exception)).not.toContain('X-One');
  });

  it('resolves a map, or a function of the request, and yields {} for nothing or a throwing function', () => {
    expect(responseHeadersOf(withResponseHeaders(new BadRequestException(), { A: 'a' }), {})).toEqual({ A: 'a' });
    expect(responseHeadersOf(withResponseHeaders(new BadRequestException(), (r) => ({ B: String((r as { v: number }).v) })), { v: 2 })).toEqual({ B: '2' });
    expect(responseHeadersOf(withResponseHeaders(new BadRequestException(), () => undefined), {})).toEqual({});
    expect(responseHeadersOf(withResponseHeaders(new BadRequestException(), () => { throw new Error('boom'); }), {})).toEqual({});
    expect(responseHeadersOf(new BadRequestException(), {})).toEqual({});
    expect(responseHeadersOf('not an exception', {})).toEqual({});
  });
});

describe('HttpExceptionFilter with branded headers', () => {
  it('sets them on the reply before the body, enveloped or verbatim', () => {
    const reply: any = { header: jest.fn().mockReturnThis(), code: jest.fn().mockReturnThis(), send: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'GET', url: '/x' }) }) } as never;
    new HttpExceptionFilter().catch(withResponseHeaders(new BadRequestException('nope'), { 'WWW-Authenticate': 'Bearer' }), host);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send.mock.calls[0][0]).toMatchObject({ statusCode: 400, message: 'nope' });
  });

  it('adds no header for an exception without the brand', () => {
    const reply: any = { header: jest.fn().mockReturnThis(), code: jest.fn().mockReturnThis(), send: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'GET', url: '/x' }) }) } as never;
    new HttpExceptionFilter().catch(new BadRequestException('nope'), host);
    expect(reply.header).not.toHaveBeenCalled();
  });
});
