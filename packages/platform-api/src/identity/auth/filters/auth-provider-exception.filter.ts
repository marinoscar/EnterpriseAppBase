import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type AuthErrorCode, buildAuthErrorRedirectUrl, resolveAuthErrorCode } from '../auth-error-codes';

/**
 * Turns a failure raised by the generic sign-in guard into the same redirect
 * the callback controller issues for its own failures: `GoogleOAuthExceptionFilter`
 * for every provider other than Google.
 *
 * The guard runs before the controller body, so its errors never reach the
 * controller's `try/catch` (consent cancelled at the provider, a replayed code,
 * an unknown or disabled provider). Applied with `@UseFilters` on the callback
 * route ONLY. Only a code from the closed set (`auth-error-codes.ts`) leaves
 * this filter; logs carry the error's name and message and never the request
 * URL, which holds the authorization code.
 *
 * @internal
 */
@Catch()
export class AuthProviderExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthProviderExceptionFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse();
    const code = resolveAuthErrorCode(exception);

    this.log(exception, code);

    // Nothing sensible can be redirected once a response has started.
    if (reply.sent || reply.raw?.headersSent) return;

    reply.redirect(buildAuthErrorRedirectUrl(this.configService.get<string>('appUrl'), code));
  }

  private log(exception: unknown, code: AuthErrorCode): void {
    const name = exception instanceof Error ? exception.name : typeof exception;
    const message = exception instanceof Error ? exception.message : '';

    // The person declining consent, or a policy refusal, is expected traffic.
    if (code === 'access_denied' || code === 'not_allowlisted' || code === 'account_disabled') {
      this.logger.warn(`Sign-in ended as ${code} (${name})`);
      return;
    }

    this.logger.error(
      `Sign-in failed before the callback handler (${name}): ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );
  }
}
