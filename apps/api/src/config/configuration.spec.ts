import configuration from './configuration';

// =============================================================================
// `ALLOWED_MIME_TYPES` / `MAX_FILE_SIZE` parsing (#519)
// =============================================================================
//
// The parsing itself lives inline in the default-exported factory rather than
// as a separately named export, so this drives that factory directly (as
// `ConfigModule.forRoot({ load: [configuration] })` does) and reads the
// `storage` slice of its result. Every other key on the returned object is
// exercised elsewhere (or not at all); this file only owns `storage`.
// =============================================================================

describe('configuration() — storage.allowedMimeTypes / storage.maxFileSize (#519)', () => {
  const ENV_KEYS = ['ALLOWED_MIME_TYPES', 'MAX_FILE_SIZE'] as const;
  let saved: Record<(typeof ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    saved = {
      ALLOWED_MIME_TYPES: process.env.ALLOWED_MIME_TYPES,
      MAX_FILE_SIZE: process.env.MAX_FILE_SIZE,
    };
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('ALLOWED_MIME_TYPES', () => {
    it('is an empty array — "allow every type" — when unset', () => {
      delete process.env.ALLOWED_MIME_TYPES;

      expect(configuration().storage.allowedMimeTypes).toEqual([]);
    });

    it('is an empty array when set to the empty string', () => {
      process.env.ALLOWED_MIME_TYPES = '';

      expect(configuration().storage.allowedMimeTypes).toEqual([]);
    });

    it('splits a comma-separated list', () => {
      process.env.ALLOWED_MIME_TYPES = 'application/pdf,image/*,video/mp4';

      expect(configuration().storage.allowedMimeTypes).toEqual([
        'application/pdf',
        'image/*',
        'video/mp4',
      ]);
    });

    it('trims whitespace around each entry', () => {
      process.env.ALLOWED_MIME_TYPES = ' application/pdf , image/*  ,video/mp4 ';

      expect(configuration().storage.allowedMimeTypes).toEqual([
        'application/pdf',
        'image/*',
        'video/mp4',
      ]);
    });

    it('lower-cases each entry', () => {
      process.env.ALLOWED_MIME_TYPES = 'APPLICATION/PDF,Image/*';

      expect(configuration().storage.allowedMimeTypes).toEqual([
        'application/pdf',
        'image/*',
      ]);
    });

    it('drops entries left empty after trimming (e.g. a trailing comma)', () => {
      process.env.ALLOWED_MIME_TYPES = 'application/pdf,, ,image/*,';

      expect(configuration().storage.allowedMimeTypes).toEqual([
        'application/pdf',
        'image/*',
      ]);
    });
  });

  describe('MAX_FILE_SIZE', () => {
    it('defaults to 10GB when unset', () => {
      delete process.env.MAX_FILE_SIZE;

      expect(configuration().storage.maxFileSize).toBe(10737418240);
    });

    it('parses a configured value', () => {
      process.env.MAX_FILE_SIZE = '1048576';

      expect(configuration().storage.maxFileSize).toBe(1048576);
    });
  });
});

describe('configuration() — eventBus.adapter (PP-1.11, #682)', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.EVENT_BUS_ADAPTER;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.EVENT_BUS_ADAPTER;
    else process.env.EVENT_BUS_ADAPTER = saved;
  });

  it('defaults to in-process when unset', () => {
    delete process.env.EVENT_BUS_ADAPTER;
    expect(configuration().eventBus.adapter).toBe('in-process');
  });

  it('passes a configured value through raw (parseEventBusAdapter is the one parse)', () => {
    process.env.EVENT_BUS_ADAPTER = 'postgres';
    expect(configuration().eventBus.adapter).toBe('postgres');
    process.env.EVENT_BUS_ADAPTER = 'redis';
    expect(configuration().eventBus.adapter).toBe('redis');
  });
});

// =============================================================================
// `DEPLOYMENT_MODE` (#685) — published RAW, parsed by common/deployment
// =============================================================================

describe('configuration() — deployment.mode (#685)', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.DEPLOYMENT_MODE;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DEPLOYMENT_MODE;
    else process.env.DEPLOYMENT_MODE = saved;
  });

  it('is undefined when unset (the parser supplies the default)', () => {
    delete process.env.DEPLOYMENT_MODE;

    expect(configuration().deployment.mode).toBeUndefined();
  });

  it('passes the value through unparsed, even an invalid one', () => {
    // The factory must not throw or rewrite: `parseDeploymentMode` is the
    // single source of truth, and `main.ts` already refused this at bootstrap.
    process.env.DEPLOYMENT_MODE = ' bogus ';

    expect(configuration().deployment.mode).toBe(' bogus ');
  });
});

describe('configuration() — deployment.network (#773)', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.DEPLOYMENT_NETWORK;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DEPLOYMENT_NETWORK;
    else process.env.DEPLOYMENT_NETWORK = saved;
  });

  it('is undefined when unset (the parser supplies online)', () => {
    delete process.env.DEPLOYMENT_NETWORK;

    expect(configuration().deployment.network).toBeUndefined();
  });

  it('passes a valid value through', () => {
    process.env.DEPLOYMENT_NETWORK = 'air-gapped';

    expect(configuration().deployment.network).toBe('air-gapped');
  });

  it('passes an invalid value through unparsed: parseDeploymentNetwork refuses it at startup', () => {
    process.env.DEPLOYMENT_NETWORK = 'offline';

    expect(configuration().deployment.network).toBe('offline');
  });
});

describe('configuration() — auth.principalCacheTtlSeconds (PP-1.12, #683)', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS;
    else process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS = saved;
  });

  it('defaults to 30 seconds when unset or blank', () => {
    delete process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS;
    expect(configuration().auth.principalCacheTtlSeconds).toBe(30);
    process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS = '  ';
    expect(configuration().auth.principalCacheTtlSeconds).toBe(30);
  });

  it('honours a whole number, including 0 (disabled)', () => {
    process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS = '5';
    expect(configuration().auth.principalCacheTtlSeconds).toBe(5);
    process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS = '0';
    expect(configuration().auth.principalCacheTtlSeconds).toBe(0);
  });

  it.each(['abc', '-1', '1.5', '30s'])('falls back to 30 for %p', (raw) => {
    process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS = raw;
    expect(configuration().auth.principalCacheTtlSeconds).toBe(30);
  });
});
