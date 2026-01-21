import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser, RequestUser } from './decorators/current-user.decorator';
import { GoogleProfile } from './strategies/google.strategy';
import {
  AuthProvidersResponseDto,
  AuthProviderDto,
} from './dto/auth-provider.dto';
import { CurrentUserDto } from './dto/auth-user.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /auth/providers
   * Returns list of enabled OAuth providers
   */
  @Public()
  @Get('providers')
  @ApiOperation({
    summary: 'List enabled OAuth providers',
    description: 'Returns a list of OAuth providers that are configured and enabled',
  })
  @ApiResponse({
    status: 200,
    description: 'List of enabled providers',
    type: AuthProvidersResponseDto,
  })
  async getProviders(): Promise<{ data: { providers: AuthProviderDto[] } }> {
    const providers = await this.authService.getEnabledProviders();
    return {
      data: {
        providers,
      },
    };
  }

  /**
   * GET /auth/google
   * Initiates Google OAuth flow
   */
  @Public()
  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({
    summary: 'Initiate Google OAuth',
    description: 'Redirects to Google OAuth consent screen',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Google OAuth',
  })
  async googleAuth() {
    // Guard handles the redirect to Google
  }

  /**
   * GET /auth/google/callback
   * Google OAuth callback endpoint
   */
  @Public()
  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({
    summary: 'Google OAuth callback',
    description: 'Handles the OAuth callback from Google and redirects to frontend with token',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to frontend with token in query params',
  })
  async googleAuthCallback(
    @Req() req: FastifyRequest & { user?: GoogleProfile },
    @Res() res: FastifyReply,
  ) {
    try {
      // Google profile is attached by the guard
      const profile = req.user;

      if (!profile) {
        this.logger.error('No profile found in Google OAuth callback');
        const appUrl = this.configService.get<string>('appUrl');
        return res.redirect(
          `${appUrl}/auth/callback?error=authentication_failed`,
        );
      }

      // Handle login and generate tokens
      const tokens = await this.authService.handleGoogleLogin(profile);

      // Redirect to frontend with token
      const appUrl = this.configService.get<string>('appUrl');
      const redirectUrl = `${appUrl}/auth/callback?token=${tokens.accessToken}`;

      return res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error('Error in Google OAuth callback', error);
      const appUrl = this.configService.get<string>('appUrl');
      return res.redirect(
        `${appUrl}/auth/callback?error=${error instanceof Error ? error.message : 'authentication_failed'}`,
      );
    }
  }

  /**
   * GET /auth/me
   * Returns current authenticated user information
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user',
    description: 'Returns information about the currently authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Current user information',
    type: CurrentUserDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing token',
  })
  async getCurrentUser(
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: CurrentUserDto }> {
    const currentUser = await this.authService.getCurrentUser(user.userId);
    return {
      data: currentUser,
    };
  }

  /**
   * POST /auth/logout
   * Logout endpoint (stateless - client discards token)
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout',
    description: 'Logout endpoint. Since JWT is stateless, client should discard the token.',
  })
  @ApiResponse({
    status: 204,
    description: 'Logout successful',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing token',
  })
  async logout(@CurrentUser() user: RequestUser): Promise<void> {
    this.logger.log(`User logged out: ${user.email}`);
    // Stateless JWT - client discards token
    // In future, could add token blacklist or refresh token revocation
  }
}
