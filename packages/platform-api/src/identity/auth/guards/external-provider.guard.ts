// =============================================================================
// The guard of the generic sign-in routes (PP-14.9)
// =============================================================================
//
// `GET /api/auth/:providerId` and `/callback` serve every registered REDIRECT
// provider that can complete a login (`mapProfile` present). This guard
//
//   1. resolves the provider from the route and answers 404 for anything that is
//      not an enabled redirect provider (unknown, `custom`, not configured: one
//      message, so the response does not tell a probe which ids exist);
//   2. for a provider that supplies `createStrategy`, builds the strategy NOW,
//      from the credential store as it is at this moment, and registers it with
//      Passport under the provider id (a rotated secret needs no restart);
//   3. runs Passport through the same raw-request/raw-response bridge
//      `GoogleOAuthGuard` uses, and copies the strategy's result to the Fastify
//      request as `req.user`.
//
// A class-based registration (`strategy` + `guard`) delegates to its own guard.
// =============================================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import passport from 'passport';

import { AuthLoginDeniedException } from '../auth-error-codes';
import { AuthService } from '../auth.service';
import { authProviderRegistry, type AuthProviderDefinition } from '../providers/auth-provider.registry';

/** The registered, enabled, redirect-mode definition behind a request, or a 404. */
const UNKNOWN_PROVIDER = 'Unknown sign-in provider';

/**
 * A Passport guard for the strategy registered under `strategyName`, bridging
 * Fastify to the raw Node objects Passport expects (the same bridge as
 * `GoogleOAuthGuard`, without Google's `select_account` option).
 *
 * @param strategyName - the name the strategy is registered with in Passport.
 * @returns a guard class.
 *
 * @stability experimental
 */
export function createPassportProviderGuard(strategyName: string): Type<CanActivate> {
  @Injectable()
  class PassportProviderGuard extends AuthGuard(strategyName) {
    getRequest(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest();
      const raw = request.raw || request;
      // Passport strategies read `req.query` (Express); Node's IncomingMessage
      // has none, so hand it the Fastify request's parsed query.
      if (raw !== request && raw.query === undefined) raw.query = request.query;
      // Return the raw Node.js IncomingMessage for Passport compatibility
      return raw;
    }

    getResponse(context: ExecutionContext) {
      const response = context.switchToHttp().getResponse();
      // Return the raw Node.js ServerResponse for Passport compatibility
      return response.raw || response;
    }

    handleRequest<TUser = unknown>(err: Error | null, user: TUser | false, _info: unknown, context: ExecutionContext): TUser {
      if (err) throw err;

      if (!user) {
        // `passport-oauth2` reports `?error=access_denied` (the person cancelled
        // or denied consent) through `fail()`. Only the code is read, never the
        // provider's `error_description`.
        const query = context.switchToHttp().getRequest()?.query as Record<string, unknown> | undefined;
        if (query?.error === 'access_denied') {
          throw new AuthLoginDeniedException('access_denied', 'Sign-in was cancelled or denied');
        }
        throw new Error('Authentication failed');
      }

      // Copy user from raw request to Fastify request so controllers can access it
      context.switchToHttp().getRequest().user = user;
      return user;
    }
  }
  return PassportProviderGuard;
}

/**
 * The guard of `AuthProviderController`.
 *
 * @internal
 */
@Injectable()
export class ExternalProviderGuard implements CanActivate {
  private readonly logger = new Logger(ExternalProviderGuard.name);
  private readonly delegates = new Map<string, CanActivate>();

  constructor(
    private readonly auth: AuthService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const id: unknown = request?.params?.providerId;
    const provider = typeof id === 'string' ? authProviderRegistry.get(id) : undefined;

    if (
      !provider ||
      (provider.mode ?? 'redirect') !== 'redirect' ||
      typeof provider.mapProfile !== 'function' ||
      !(await this.auth.isProviderEnabled(provider))
    ) {
      throw new NotFoundException(UNKNOWN_PROVIDER);
    }

    return (await this.delegateFor(provider)).canActivate(context) as Promise<boolean> | boolean;
  }

  private async delegateFor(provider: AuthProviderDefinition): Promise<CanActivate> {
    if (provider.createStrategy) {
      // Rebuilt for every request: the strategy reads the credential store, and
      // a secret an administrator rotated must apply to the next sign-in.
      const strategy = await provider.createStrategy(this.auth.authProviderContext());
      passport.use(provider.id, strategy);
      let delegate = this.delegates.get(provider.id);
      if (!delegate) {
        delegate = new (createPassportProviderGuard(provider.id))();
        this.delegates.set(provider.id, delegate);
      }
      return delegate;
    }

    let delegate = this.delegates.get(provider.id);
    if (!delegate) {
      if (!provider.guard) {
        this.logger.error(`Sign-in provider "${provider.id}" has neither createStrategy nor a guard`);
        throw new NotFoundException(UNKNOWN_PROVIDER);
      }
      delegate = await this.moduleRef.create(provider.guard);
      this.delegates.set(provider.id, delegate);
    }
    return delegate;
  }
}
