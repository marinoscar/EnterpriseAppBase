// Google, the first registered sign-in provider (issue #727). Registered when
// the identity slice loads; enabled when GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET are set (the app's `google.clientId` and
// `google.clientSecret` configuration keys), exactly as before the registry.
import { GoogleOAuthGuard } from '../guards/google-oauth.guard';
import { GoogleStrategy } from '../strategies/google.strategy';
import { authProviderRegistry } from './auth-provider.registry';

if (!authProviderRegistry.has('google')) {
  authProviderRegistry.register({
    id: 'google',
    strategy: GoogleStrategy,
    guard: GoogleOAuthGuard,
    isEnabled: (config) => Boolean(config.get<string>('google.clientId') && config.get<string>('google.clientSecret')),
  });
}
