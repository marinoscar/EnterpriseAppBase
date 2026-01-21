import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Google OAuth guard
 *
 * Initiates the Google OAuth flow when applied to a route.
 * Used on both the initial OAuth endpoint and the callback endpoint.
 */
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {}
