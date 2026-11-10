// The consumer app's bootstrap: Fastify, the `api` prefix and nestjs-zod's
// validation pipe, as in apps/api/src/main.ts. `createApp()` is what the
// smoke test boots; running this file directly listens on PORT (default 3000).

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from './app.module';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ['error', 'warn'],
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  return app;
}

export function buildOpenApiDocument(app: NestFastifyApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('Consumer smoke').setVersion('0.0.0').build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

if (require.main === module) {
  void createApp().then((app) => app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1'));
}
