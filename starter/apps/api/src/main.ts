import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { verifyEncryptionKeyAtStartup } from '@marinoscar/platform-api/core';
import { verifyTenancyModeAtStartup } from '@marinoscar/platform-api/identity';

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

/** Builds the application: Fastify, the cookie plugin, the `/api` prefix. Shared by the boot and the db-tier tests. */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: false });
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET });
  app.setGlobalPrefix('api');
  return app;
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  if (process.env.NODE_ENV === 'production' && process.env.TEST_AUTH_ENABLED === 'true') {
    throw new Error('TEST_AUTH_ENABLED must not be true in production');
  }
  // Fail fast, before a port is bound: a bad TENANCY_MODE, or stored
  // credentials without the SECRETS_ENCRYPTION_KEY that decrypts them.
  verifyTenancyModeAtStartup(process.env, logger);
  const app = await createApp();
  await verifyEncryptionKeyAtStartup(() => app.get(PrismaService).credential.count(), logger);
  app.enableShutdownHooks();
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on :${port}/api`);
}

if (require.main === module) {
  void bootstrap();
}
