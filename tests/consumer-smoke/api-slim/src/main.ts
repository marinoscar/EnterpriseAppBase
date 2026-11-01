// The slim consumer (issue #914): an app that wants only `core`, `otel-core`
// and `telemetry`. Its package.json installs the peers
// `node scripts/check-slice-peers.mjs --table` lists for `telemetry` and
// nothing else: no @nestjs/jwt, @nestjs/passport, passport,
// @nestjs/event-emitter or @nestjs/terminus.
// Every import below is a public subpath of @marinoscar/platform-api.

import 'reflect-metadata';

import { applyDecorators, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { definePlatformHost } from '@marinoscar/platform-api/core';
import { MetricsHostService, OtelMetricsModule, Trace } from '@marinoscar/platform-api/otel-core';
import { TelemetryModule } from '@marinoscar/platform-api/telemetry';

@Injectable()
export class Greeter {
  @Trace()
  async hello(name: string): Promise<string> {
    return `hello ${name}`;
  }
}

@Module({ imports: [OtelMetricsModule.forRoot()], providers: [Greeter] })
export class SlimModule {}

/** A host whose access decorators do nothing: this consumer mounts no route. */
export const slimHost = definePlatformHost({
  access: {
    requirePermissions: () => applyDecorators(),
    requireAuthenticated: () => applyDecorators(),
  },
});

/** The module metadata `TelemetryModule.forRoot` builds (no boot: the telemetry ports are an app's to bind). */
export function telemetryModuleMetadata() {
  return TelemetryModule.forRoot({ host: slimHost, imports: [] });
}

export async function bootSlim() {
  const app = await NestFactory.createApplicationContext(SlimModule, { logger: false });
  return {
    app,
    greeter: app.get(Greeter),
    metrics: app.get(MetricsHostService),
  };
}
