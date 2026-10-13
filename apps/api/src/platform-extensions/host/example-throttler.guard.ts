import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

// =============================================================================
// EXAMPLE: an app-wide throttler next to the maintenance guard (PP-14.13)
// =============================================================================
//
// The platform's only global guard is `MaintenanceGuard`, and the `host`
// conformance suite fails an app that registers another one, because a global
// guard runs in front of every route and a route without `@Auth()` is public.
// An app that does want one (a rate limiter, a tenant resolver) says so in the
// suite's `allowedAppGuards` option, with the reason in writing:
//
//   runPlatformConformance({
//     sourceRoots: [...],
//     suites: {
//       host: {
//         rootModule: AppModule,
//         allowedAppGuards: [{ name: 'ExampleThrottlerGuard', why: 'Global rate limit; it authenticates nobody.' }],
//       },
//     },
//   });
//
// Two things stay required: `PlatformHostCoreModule.forRoot()` is imported
// BEFORE the module that registers the guard (global guards run in module
// order, and the maintenance window is decided first), and the entry names a
// guard the graph really registers (a stale entry is a finding).
//
// A guard like this must not authenticate, authorize, read the body or open a
// database connection: it runs for every request, including the ones the window
// is about to refuse. This one counts requests per client address in a fixed
// window, in this process only.
//
// This module is NOT imported by `AppModule`; `test/examples/host/` composes it.
// =============================================================================

/** Requests allowed per client address and window. */
export const EXAMPLE_THROTTLE_LIMIT = 100;

/** The window, in milliseconds. */
export const EXAMPLE_THROTTLE_WINDOW_MS = 60_000;

/** A fixed-window, in-memory, per-address request limit. */
@Injectable()
export class ExampleThrottlerGuard implements CanActivate {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const key = request.ip ?? 'unknown';
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= EXAMPLE_THROTTLE_WINDOW_MS) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    if (current.count > EXAMPLE_THROTTLE_LIMIT) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

/** Registers {@link ExampleThrottlerGuard} as a global guard. Import it AFTER `PlatformHostCoreModule.forRoot()`. */
@Module({ providers: [{ provide: APP_GUARD, useClass: ExampleThrottlerGuard }] })
export class ExampleThrottlerModule {}
