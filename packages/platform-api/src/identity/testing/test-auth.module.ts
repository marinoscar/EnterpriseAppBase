import { PrincipalCacheModule } from '../auth/principal-cache/principal-cache.module';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OrganizationsModule } from '../organizations/organizations.module';
import { TestAuthController } from './test-auth.controller';
import { TestAuthService } from './test-auth.service';
import { requireJwtSecret } from '../identity.configuration';

@Module({
  imports: [
    // PP-1.12 (#683): the role swap invalidates principals.
    PrincipalCacheModule,
    // JWT configuration (reuse from AuthModule)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
        signOptions: {
          expiresIn: `${config.get<number>('jwt.accessTtlMinutes', 15)}m`,
        },
      }),
    }),
    ConfigModule,
    // PP-6.1 (#721): a new test user joins the default org.
    OrganizationsModule,
  ],
  controllers: [TestAuthController],
  providers: [TestAuthService],
  exports: [TestAuthService],
})
export class TestAuthModule {}
