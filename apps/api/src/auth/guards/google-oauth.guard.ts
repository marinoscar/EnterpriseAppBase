import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Google OAuth guard for Fastify
 *
 * Initiates the Google OAuth flow when applied to a route.
 * Used on both the initial OAuth endpoint and the callback endpoint.
 *
 * Note: Passport OAuth strategies expect Express-style request/response objects.
 * This guard overrides getRequest/getResponse to return raw Node.js http objects
 * that Passport can work with.
 */
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  getRequest(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    // Return the raw Node.js IncomingMessage for Passport compatibility
    return request.raw || request;
  }

  getResponse(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse();
    // Return the raw Node.js ServerResponse for Passport compatibility
    return response.raw || response;
  }
}
