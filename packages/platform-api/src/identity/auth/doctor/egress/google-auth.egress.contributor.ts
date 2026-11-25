// The sign-in providers' egress contributor, under the path and class name it
// had when Google was the only provider. The implementation is generic
// (`./auth-providers.egress.contributor.ts`): it still emits `auth.google` and
// `auth.google.avatars` first, then one dependency per other registered
// provider that declared `egressHosts`.
export {
  AuthProvidersEgressContributor as GoogleAuthEgressContributor,
  GOOGLE_AVATAR_HOSTS,
  GOOGLE_OAUTH_HOSTS,
} from './auth-providers.egress.contributor';
