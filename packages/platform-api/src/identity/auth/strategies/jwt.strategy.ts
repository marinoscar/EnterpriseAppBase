import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * JWT payload structure
 */
export interface JwtPayload {
  sub: string; // User ID
  email: string;
  roles: string[];
  /**
   * Device-authorization session id (`device_codes.id`), present only on an
   * access token issued through the device flow's session path or a refresh
   * of one (issue #518). Its presence makes every request re-check that the
   * device session is still live — see `AuthService.validateJwtPayload` — so
   * `DELETE /api/auth/device/sessions/{id}` takes effect immediately rather
   * than when the long-lived device access token expires.
   */
  did?: string;
  /**
   * The active organization's id (#724): the org this access token acts in.
   * Set on EVERY token the API issues (sign-in, refresh, switch-org, device
   * session). Trusted only after `AuthService.validateJwtPayload` re-checks
   * it is an active membership of `sub`. Optional in the type only because a
   * token issued before #724 has none: such a token is accepted in single
   * mode, mapped to the default organization, for one access-token lifetime
   * after the deploy, and refused in multi mode (a temporary compatibility
   * path, removed in a later release).
   */
  org?: string;
}

/**
 * JWT authentication strategy
 *
 * Validates JWT tokens and attaches user information to the request.
 * Tokens are extracted from the Authorization header as Bearer tokens.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'fallback-secret',
    });
  }

  /**
   * Validates the JWT payload and returns the user object
   * This method is called after the JWT signature is verified
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.authService.validateJwtPayload(payload);

    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    return user;
  }
}
