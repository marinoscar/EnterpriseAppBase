import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { TestEnvironmentGuard } from './guards/test-environment.guard';
import { TestAuthService } from './test-auth.service';
import { TestLoginDto } from './dto/test-login.dto';
import { AllowDuringMaintenance } from '../common/maintenance/allow-during-maintenance.decorator';
import {
  AuthLoginDeniedException,
  buildAuthErrorRedirectUrl,
} from '../auth/auth-error-codes';

const REFRESH_TOKEN_COOKIE = 'refresh_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 14 * 24 * 60 * 60, // 14 days in seconds
};

/**
 * REACHABLE DURING A MAINTENANCE WINDOW (#257).
 *
 * This module is only registered when `NODE_ENV !== 'production'`, so the
 * exemption cannot widen a production deployment's surface at all. Where it IS
 * registered it is how automated tests obtain a token, and a suite that could
 * not authenticate would be unable to test any of the behaviour a window is
 * supposed to have — including whether the window itself works.
 */
@ApiTags('Test Authentication')
@Controller('auth/test')
@AllowDuringMaintenance()
export class TestAuthController {
  private readonly logger = new Logger(TestAuthController.name);

  constructor(
    private readonly testAuthService: TestAuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /auth/test/login
   * Test authentication endpoint - bypasses OAuth for E2E testing
   */
  @Public()
  @Post('login')
  @UseGuards(TestEnvironmentGuard)
  @ApiOperation({
    summary: 'Test login (non-production only)',
    description:
      'Authenticate as any user for testing purposes. Only available in non-production environments.',
  })
  @ApiResponse({
    status: 302,
    description:
      'Redirects to /auth/callback with an access token, or to /auth/callback?error=<code> when the ' +
      'login is refused by policy (no_organization in multi-org tenancy mode)',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only available in non-production environments',
  })
  async testLogin(
    @Body() dto: TestLoginDto,
    @Res() res: FastifyReply,
  ): Promise<void> {
    this.logger.log(`Test login request for: ${dto.email}`);

    let result;
    try {
      result = await this.testAuthService.loginAsTestUser(dto);
    } catch (error) {
      // A policy refusal (PP-6.2, #722: `no_organization` in multi-org mode)
      // lands where a Google sign-in's does, `/auth/callback?error=<code>`, so
      // an e2e suite sees the real sign-in error page.
      if (error instanceof AuthLoginDeniedException) {
        return res
          .status(302)
          .redirect(buildAuthErrorRedirectUrl(this.configService.get<string>('appUrl'), error.reason));
      }
      throw error;
    }

    // Set refresh token in HttpOnly cookie
    res.setCookie(REFRESH_TOKEN_COOKIE, result.refreshToken, COOKIE_OPTIONS);

    // Redirect to frontend with access token
    const appUrl = this.configService.get<string>('appUrl');
    const redirectUrl = new URL('/auth/callback', appUrl);
    redirectUrl.searchParams.set('token', result.accessToken);
    redirectUrl.searchParams.set('expiresIn', result.expiresIn.toString());

    this.logger.log(`Test login successful, redirecting to: ${redirectUrl.toString()}`);
    return res.status(302).redirect(redirectUrl.toString());
  }
}
