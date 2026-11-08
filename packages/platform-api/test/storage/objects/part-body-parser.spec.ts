import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { UnsupportedMediaTypeException } from '@nestjs/common';

import { registerStoragePartBodyParser } from '../../../src/storage/objects/part-body-parser';
import { ObjectsController } from '../../../src/storage/objects/objects.controller';

describe('registerStoragePartBodyParser', () => {
  const build = async () => {
    const app = Fastify();
    registerStoragePartBodyParser(app);

    app.put('/api/storage/objects/:id/upload/parts/:partNumber', async (request) => {
      const body = request.body;
      if (!(body instanceof Readable)) return { stream: false };
      let bytes = 0;
      for await (const chunk of body) bytes += (chunk as Buffer).length;
      return { stream: true, bytes };
    });
    app.put('/api/other', async () => ({ ok: true }));
    app.post('/api/json', async (request) => ({ got: request.body }));
    await app.ready();
    return app;
  };

  it('hands the part route its body as the unread stream, whatever content type labels it', async () => {
    const app = await build();
    for (const type of ['application/octet-stream', 'image/jpeg', 'video/mp4']) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/storage/objects/11111111-1111-4111-8111-111111111111/upload/parts/2',
        headers: { 'content-type': type },
        payload: Buffer.alloc(4096, 1),
      });
      expect(res.json()).toEqual({ stream: true, bytes: 4096 });
    }
    await app.close();
  });

  it('keeps answering 415 for every other route with an unknown content type', async () => {
    const app = await build();
    const res = await app.inject({ method: 'PUT', url: '/api/other', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(8) });
    expect(res.statusCode).toBe(415);
    await app.close();
  });

  it('leaves the JSON parser alone', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/json', payload: { a: 1 } });
    expect(res.json()).toEqual({ got: { a: 1 } });
    await app.close();
  });
});

describe('ObjectsController.uploadPart', () => {
  const service = { uploadPart: jest.fn() };
  const controller = new ObjectsController(service as never);
  const reply = () => {
    const r: any = { status: jest.fn(() => r), header: jest.fn(() => r), send: jest.fn(() => r) };
    return r;
  };

  beforeEach(() => service.uploadPart.mockReset());

  it('streams req.body to the service and answers 200, an empty body and the quoted ETag header', async () => {
    service.uploadPart.mockResolvedValue({ eTag: '"abc"' });
    const body = Readable.from([Buffer.alloc(3)]);
    const res = reply();

    await controller.uploadPart('obj', 2, { body, headers: { 'content-length': '3' } } as never, res, 'user', 'org');

    expect(service.uploadPart).toHaveBeenCalledWith('obj', 2, 'user', 'org', body, 3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.header).toHaveBeenCalledWith('ETag', '"abc"');
    expect(res.send).toHaveBeenCalledWith();
  });

  it('is a 415 RAW_BODY_REQUIRED when a buffering parser already consumed the body', async () => {
    const error = await controller
      .uploadPart('obj', 1, { body: { a: 1 }, headers: {} } as never, reply(), 'user', 'org')
      .catch((e) => e);

    expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
    expect(error.getResponse().details).toEqual({ reason: 'RAW_BODY_REQUIRED' });
    expect(service.uploadPart).not.toHaveBeenCalled();
  });
});
