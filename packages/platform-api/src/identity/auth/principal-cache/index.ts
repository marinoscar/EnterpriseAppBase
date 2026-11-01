// Public surface of the JWT principal cache (PP-1.12, issue #683).
export {
  PRINCIPAL_CACHE_CLOCK,
  PRINCIPAL_CACHE_MAX_ENTRIES,
  PRINCIPAL_INVALIDATE_CHANNEL,
  PrincipalCache,
} from './principal-cache.service';
export type { PrincipalCacheKey, PrincipalCacheStats, PrincipalInvalidation } from './principal-cache.service';
export {
  DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS,
  parsePrincipalCacheTtlSeconds,
} from './principal-cache.config';
export { PrincipalCacheModule } from './principal-cache.module';
