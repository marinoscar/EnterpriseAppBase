import { Controller, Get, Logger, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AllowDuringMaintenance } from '../../core/index';
import { AuthService } from './auth.service';
import { buildAuthErrorRedirectUrl } from './auth-error-codes';
import type { CookieReply as FastifyReply, CookieRequest as FastifyRequest } from './cookie-http';
import { assertExternalProfile } from './external-profile';
import { AuthProviderExceptionFilter } from './filters/auth-provider-exception.filter';
import { ExternalProviderGuard } from './guards/external-provider.guard';
import { Public } from './decorators/public.decorator';
import { authProviderRegistry } from './providers/auth-provider.registry';
import { respondToSignIn } from './sign-in-response';

/**
 * The sign-in routes of every registered `redirect` provider other than
 * Google, whose own routes stay in `AuthController` (a static route outranks
 * `:providerId`, so `/api/auth/google` is never served from here):
 *
 *   `GET /api/auth/:providerId`           starts the sign-in (Passport redirects to the provider)
 *   `GET /api/auth/:providerId/callback`  completes it: maps the profile, signs in, sets the refresh cookie, redirects
 *
 * Reachable during a maintenance window for the same reason `AuthController` is
 * (signing in is how an administrator ends a window). A provider that is
 * unknown, `custom` or not configured is a 404 on the start route and, on the
 * callback route, a 302 to `error=authentication_failed` (the callback's filter
 * turns every guard failure into the closed-set redirect; see `ExternalProviderGuard`).
 *
 * @internal
 */
@ApiTags('Authentication')
@Controller('auth')
@AllowDuringMaintenance()
export class AuthProviderController {
  private readonly logger = new Logger(AuthProviderController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /auth/:providerId
   * Initiates the provider's sign-in flow.
   */
  @Public()
  @Get(':providerId')
  @UseGuards(ExternalProviderGuard)
  @ApiOperation({
    summary: 'Initiate sign-in with a registered provider',
    description:
      'Redirects to the sign-in provider named by `providerId` (any provider an app registered with `registerAuthProvider` in `redirect` mode; the provider ids a deployment offers are listed by `GET /api/auth/providers`). 404 for an unknown, `custom` or not configured provider.',
  })
  @ApiParam({ name: 'providerId', description: 'The registered provider id, e.g. `github`.', schema: { type: 'string', example: 'github' } })
  @ApiResponse({ status: 302, description: 'Redirects to the sign-in provider' })
  @ApiResponse({ status: 404, description: 'Unknown, custom or not configured provider' })
  async start() {
    // Guard handles the redirect to the provider
  }

  /**
   * GET /auth/:providerId/callback
   * The provider's callback endpoint.
   */
  @Public()
  @Get(':providerId/callback')
  @UseGuards(ExternalProviderGuard)
  // Callback route only: guard failures run before the method body, so its
  // try/catch never sees them.
  @UseFilters(AuthProviderExceptionFilter)
  @ApiOperation({
    summary: 'Sign-in provider callback',
    description:
      'Handles the callback from a registered sign-in provider and redirects to the frontend /auth/callback page: with the access token on success (the refresh token is set in the HttpOnly `refresh_token` cookie, exactly as for Google), or with error=<code> on any failure.',
  })
  @ApiParam({ name: 'providerId', description: 'The registered provider id, e.g. `github`.', schema: { type: 'string', example: 'github' } })
  @ApiResponse({
    status: 302,
    description:
      'Redirects to frontend with the token in query params, or with error set to one of not_allowlisted, account_disabled, access_denied, authentication_failed, server_misconfigured, no_organization. An unknown, custom or not configured provider is also a 302, with error=authentication_failed (not a 404).',
  })
  async callback(@Req() req: FastifyRequest & { user?: unknown }, @Res() res: FastifyReply) {
    const appUrl = this.configService.get<string>('appUrl');
    const params = req.params as { providerId?: string } | undefined;
    const provider = params?.providerId ? authProviderRegistry.get(params.providerId) : undefined;
    // The guard attached the strategy's result and proved the provider; a
    // missing one is a refusal, never a login.
    const raw = req.user;

    if (!provider || !provider.mapProfile || !raw) {
      this.logger.error('No profile found in a sign-in provider callback');
      return res.status(302).redirect(buildAuthErrorRedirectUrl(appUrl, 'authentication_failed'));
    }

    const mapProfile = provider.mapProfile.bind(provider);
    return respondToSignIn({
      reply: res,
      appUrl,
      logger: this.logger,
      label: `${provider.id} sign-in callback`,
      signIn: async () => {
        // The id is the SERVING definition's, whatever the strategy or the
        // mapper put in `provider`: a provider cannot present itself as another.
        const profile = { ...mapProfile(raw), provider: provider.id };
        assertExternalProfile(profile);
        return this.authService.completeExternalLogin(profile);
      },
    });
  }
}
