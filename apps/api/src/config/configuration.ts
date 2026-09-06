import { buildDatabaseUrl } from '../common/database-url';

export default () => {
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'postgres';
  const password = process.env.POSTGRES_PASSWORD || 'postgres';
  const dbName = process.env.POSTGRES_DB || 'appdb';
  const ssl = process.env.POSTGRES_SSL === 'true';

  // Built by the shared helper, NOT interpolated here. This module used to do
  // its own interpolation without percent-encoding, and because the line below
  // assigns the result to process.env.DATABASE_URL — which PrismaService then
  // trusts — that unencoded string overwrote the encoded one the service had
  // been careful to build. See src/common/database-url.ts.
  const databaseUrl = buildDatabaseUrl();

  // Prisma reads DATABASE_URL (prisma.config.ts, and the generated client),
  // so publish the derived value for it.
  process.env.DATABASE_URL = databaseUrl;

  return {
    // Application
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    appUrl: process.env.APP_URL || 'http://localhost:3535',

    // Database
    database: {
      host,
      port: parseInt(port, 10),
      user,
      password,
      name: dbName,
      ssl,
      url: databaseUrl,
    },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    accessTtlMinutes: parseInt(process.env.JWT_ACCESS_TTL_MINUTES || '15', 10),
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS || '14', 10),
  },

  // SECRETS_ENCRYPTION_KEY is DELIBERATELY ABSENT from this object (#116,
  // epic #108). It is read directly from process.env by
  // common/crypto/secret-cipher.ts, which caches it once and never re-reads,
  // and validated at bootstrap by common/crypto/encryption-key-startup-check.ts.
  // Adding it here would create a second source of truth that could disagree
  // with the cached one, and would put raw key material into the ConfigService
  // object — a structure that is far easier to log, dump to a debug endpoint or
  // serialise wholesale than a module-private Buffer. Do not add it.

  // OAuth - Google
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },

  // Web Push (issue #229, epic #215) — deploy-time VAPID key pair.
  //
  // Read exactly like `google` above: plain `process.env`, no default, no
  // validation at this layer. `undefined` is the correct value for a
  // deployment that has not generated keys — `PushSubscriptionService.isEnabled`
  // is what turns "these are unset" into "Web Push is off", not this file.
  //
  // Deliberately NOT run through `common/crypto/secret-cipher.ts` /
  // `SECRETS_ENCRYPTION_KEY`, for the same reason `google.clientSecret` isn't:
  // that machinery encrypts credentials an ADMIN ENTERS AT RUNTIME through the
  // app before they land in the `credentials` table. A VAPID key pair is
  // generated once at deploy time (`npx web-push generate-vapid-keys`) and
  // supplied as an environment variable, exactly like `GOOGLE_CLIENT_SECRET` —
  // there is no runtime entry path for it, so there is nothing for that cipher
  // to do here.
  push: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT,
  },

  // Admin bootstrap
  initialAdminEmail: process.env.INITIAL_ADMIN_EMAIL,

  // Device Authorization Flow (RFC 8628)
  //
  // Two independent lifetimes live here, and conflating them is the mistake to
  // avoid (#141, epic #110):
  //
  //   tokenExpiryDays (DEVICE_TOKEN_EXPIRY_DAYS) — the SESSION credential the
  //     browser-driven activation page has always produced. Short by design;
  //     it is a JWT, so it cannot be revoked before it expires. Raising it to
  //     CLI-friendly lengths would weaken every device session in the app to
  //     serve one client, which is exactly the alternative epic #110 rejected.
  //
  //   patExpiryDays (DEVICE_PAT_EXPIRY_DAYS) — the lifetime of the personal
  //     access token minted when a device asks for `clientInfo.tokenType:
  //     'pat'`. It can be far longer precisely BECAUSE a PAT is revocable
  //     server-side: a stolen laptop is handled by deleting one row in the
  //     Access Tokens page, with nothing else to rotate. 90 days matches the
  //     epic's suggestion and MemoriaHub's reference CLI.
  deviceAuth: {
    expiryMinutes: parseInt(process.env.DEVICE_CODE_EXPIRY_MINUTES || '15', 10),
    pollInterval: parseInt(process.env.DEVICE_CODE_POLL_INTERVAL || '5', 10),
    tokenExpiryDays: parseInt(process.env.DEVICE_TOKEN_EXPIRY_DAYS || '7', 10),
    patExpiryDays: parseInt(process.env.DEVICE_PAT_EXPIRY_DAYS || '90', 10),
  },

  // Background job queue — the terminal state machine's budgets and backoff
  // (issue #261, epic #254).
  //
  // TWO INDEPENDENT BUDGETS, and conflating them is the mistake to avoid.
  // `maxAttempts` bounds BUGS: a handler that keeps throwing should burn
  // through a small budget quickly and land in `failed` where a human sees
  // it. `rateLimitMaxHits` bounds WAITING: a provider throttling us is not
  // the job failing, so a deferral must not spend the attempt budget at all
  // (`JobTerminalService` explicitly un-charges the claim-time increment) and
  // it gets its own, much larger, allowance on a much longer timescale.
  // A single combined counter would let a long backfill against a
  // rate-limited provider exhaust it in the first minute and fail
  // permanently for a transient reason that was never its fault.
  //
  // Each pair of *BaseMs / *MaxMs feeds the same equal-jitter exponential
  // backoff (`src/jobs/backoff.util.ts`); only the constants differ —
  // seconds for a retry, minutes for a provider cooldown.
  //
  // THE WORKER POOL'S OWN FIVE (issue #262) sit in the same block because
  // they bound the same thing from the other end: the four above decide what
  // happens to a job that stopped, these decide how many jobs may be running
  // at once, how eagerly an empty queue is asked again, which types this
  // process is allowed to take, and how long one job may hold a slot.
  //
  // `workerMode` is a plain string rather than a union parsed here, and
  // `JobWorker.mode()` validates it on every claim: an unrecognised value
  // FAILS OPEN to "all" with a single warning, because a typo in an env file
  // silently stopping every background job is a far worse outcome than
  // running the default loudly. Validating it here would have to decide
  // between throwing at boot (the fail-closed outcome, rejected) and
  // silently rewriting the value (the same fallback, further from the log
  // line that explains it).
  //
  // The lease a claim is taken with is DERIVED from `jobTimeoutMs` rather
  // than configured, so it cannot be set shorter than the timeout it has to
  // outlive — see `LEASE_GRACE_MS` in `src/jobs/job.worker.ts`.
  jobs: {
    maxAttempts: parseInt(process.env.JOBS_MAX_ATTEMPTS || '3', 10),
    retryBaseMs: parseInt(process.env.JOBS_RETRY_BASE_MS || '2000', 10),
    retryMaxMs: parseInt(process.env.JOBS_RETRY_MAX_MS || '60000', 10),
    rateLimitMaxHits: parseInt(process.env.JOBS_RATELIMIT_MAX_HITS || '10', 10),
    rateLimitBaseMs: parseInt(process.env.JOBS_RATELIMIT_BASE_MS || '30000', 10),
    rateLimitMaxMs: parseInt(process.env.JOBS_RATELIMIT_MAX_MS || '900000', 10),
    workerConcurrency: parseInt(process.env.JOBS_WORKER_CONCURRENCY || '2', 10),
    pollMs: parseInt(process.env.JOBS_POLL_MS || '5000', 10),
    workerMode: process.env.JOBS_WORKER_MODE || 'all',
    jobTimeoutMs: parseInt(process.env.JOBS_JOB_TIMEOUT_MS || '600000', 10),
    // Split here rather than in the worker so the shape a consumer reads is
    // the shape it wants, and an unset variable is an empty list rather than
    // `['']` — which would look like a job type named "" to every caller.
    systemModeExtraTypes: (process.env.JOBS_SYSTEM_MODE_EXTRA_TYPES || '')
      .split(',')
      .map((type) => type.trim())
      .filter((type) => type.length > 0),
  },

  // Observability
  otel: {
    enabled: process.env.OTEL_ENABLED === 'true',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: process.env.OTEL_SERVICE_NAME || 'enterprise-app-api',
  },

  // Storage Configuration
  storage: {
    provider: process.env.STORAGE_PROVIDER || 's3',
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      endpoint: process.env.S3_ENDPOINT || undefined,
    },
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10737418240', 10), // 10GB default
    allowedMimeTypes: (
      process.env.ALLOWED_MIME_TYPES || 'image/*,application/pdf,video/*'
    ).split(','),
    signedUrlExpiry: parseInt(process.env.SIGNED_URL_EXPIRY || '3600', 10), // 1 hour default
    partSize: parseInt(process.env.STORAGE_PART_SIZE || '10485760', 10), // 10MB default
  },

  // Email transports (issue #122, epic #109)
  //
  // NO NEW SECRET IS INTRODUCED HERE. SES reuses the AWS credentials this
  // deployment already has in its environment for S3 — the same two variables,
  // read again, so an operator who has storage working has email working with
  // no additional key to issue, rotate, or leak.
  //
  // Read from `process.env` DIRECTLY rather than from `storage.s3.*` above,
  // deliberately. What email shares with storage is the ENVIRONMENT, not
  // storage's configuration: pointing email at `storage.s3` would make it
  // break the day someone gives storage its own credential source, and it is
  // the same coupling epic #109 explicitly rejects (MemoriaHub's SES provider
  // reads the S3 storage provider's database credentials, so email silently
  // depends on storage being configured at all).
  //
  // `sesRegionFallback` has NO DEFAULT, unlike `storage.s3.region`. A wrong
  // region does not fail as "wrong region": SES answers that the sending
  // identity is not verified, because the identity is verified in the region
  // the admin actually uses. An unset region reported as "SES region is not
  // configured" is a far better error than us-east-1 guessing wrong.
  email: {
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    sesRegionFallback: process.env.S3_REGION || '',
  },

  logLevel: process.env.LOG_LEVEL || 'info',
  };
};
