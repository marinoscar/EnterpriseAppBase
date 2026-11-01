// Google, the first registered sign-in provider (issue #727). Registered when
// the identity slice loads; enabled when GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET are set (the app's `google.clientId` and
// `google.clientSecret` configuration keys), exactly as before the registry.
//
// Google keeps the class-based path (`strategy` + `guard`, built by Nest at
// boot from the environment-backed configuration) and its own routes in
// `AuthController`; only its profile mapping and its linking rule are stated
// here, as data, so the shared sign-in path reads them like any provider's.
import { GoogleOAuthGuard } from '../guards/google-oauth.guard';
import { GoogleStrategy } from '../strategies/google.strategy';
import { googleProfileToExternal } from '../external-profile';
import { authProviderRegistry } from './auth-provider.registry';

/** Hosts Google sign-in needs (the API exchanges the code and reads the profile; the browser signs in). */
export const GOOGLE_OAUTH_HOSTS = ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'] as const;

if (!authProviderRegistry.has('google')) {
  authProviderRegistry.register({
    id: 'google',
    label: 'Google',
    strategy: GoogleStrategy,
    guard: GoogleOAuthGuard,
    isEnabled: (config) => Boolean(config.get<string>('google.clientId') && config.get<string>('google.clientSecret')),
    mapProfile: googleProfileToExternal,
    // Google links a new sign-in to the user holding the same address: its
    // addresses are verified by Google and the behaviour predates the seam.
    linkExistingByEmail: true,
    egressHosts: GOOGLE_OAUTH_HOSTS,
    doctorRemedy:
      'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL (see infra/compose/.env.example) and restart the API.',
  });
}
