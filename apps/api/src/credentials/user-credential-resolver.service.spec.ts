import { Test, TestingModule } from '@nestjs/testing';

import { UserCredentialResolver } from './user-credential-resolver.service';
import { UserCredentialsService } from './user-credentials.service';
import { CredentialsService } from './credentials.service';
import {
  findUserCredentialPurpose,
  UserCredentialPurposeDef,
} from './user-credential-purposes';

// =============================================================================
// UserCredentialResolver — tests (issue #387)
// =============================================================================
//
// This encodes the one fixed rule ("whose key do we use?") described in the
// class's own header: the user's own credential always wins; the system
// fallback applies only when the registry names one AND the user has none;
// and a THROW from either store (an undecryptable credential) must propagate
// rather than silently falling through to the other store. The last case is
// singled out in the class comment as the one that matters most, because
// losing it means a user silently starts spending the deployment's quota
// while believing they are on their own key.
//
// WHY findUserCredentialPurpose IS MOCKED AT THE MODULE BOUNDARY RATHER THAN
// BY INJECTING REAL ENTRIES INTO USER_CREDENTIAL_PURPOSES: that array is
// `Object.freeze`d and, as of #387, deliberately EMPTY (see that file's own
// header - there is no real purpose yet to exercise this resolver against).
// Mutating a frozen array is not an option, and even if it were not frozen,
// mutating a module-level singleton used elsewhere in the process is a shared
// hazard other test files would need to know to reset. Mocking the lookup
// function is the seam #387 already exposes for exactly this: the resolver
// calls `findUserCredentialPurpose(purpose)` as a plain function, so replacing
// that one export lets this spec inject whatever registry entries a given
// test needs without touching the (still-empty, still-frozen) real array.
// Whoever adds the first real purpose entry will hit this same need again;
// keep mocking the function rather than switching to array mutation.
// =============================================================================

jest.mock('./user-credential-purposes', () => ({
  findUserCredentialPurpose: jest.fn(),
}));

const mockFindPurpose = findUserCredentialPurpose as jest.MockedFunction<
  typeof findUserCredentialPurpose
>;

function registryEntry(
  overrides: Partial<UserCredentialPurposeDef> = {},
): UserCredentialPurposeDef {
  return {
    purpose: 'llm',
    label: 'AI provider API key',
    description: 'Your own API key.',
    systemFallback: { purpose: 'llm', name: 'default' },
    ...overrides,
  };
}

describe('UserCredentialResolver', () => {
  let resolver: UserCredentialResolver;
  let userCredentials: { getSecret: jest.Mock };
  let credentials: { getSecret: jest.Mock };

  const USER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

  beforeEach(async () => {
    userCredentials = { getSecret: jest.fn() };
    credentials = { getSecret: jest.fn() };
    mockFindPurpose.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserCredentialResolver,
        { provide: UserCredentialsService, useValue: userCredentials },
        { provide: CredentialsService, useValue: credentials },
      ],
    }).compile();

    resolver = module.get<UserCredentialResolver>(UserCredentialResolver);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns the user's own credential, tagged source 'user', and never queries the system store", async () => {
    userCredentials.getSecret.mockResolvedValue('users-own-key');

    const result = await resolver.resolve(USER_ID, 'llm', 'default');

    expect(result).toEqual({ secret: 'users-own-key', source: 'user' });
    expect(credentials.getSecret).not.toHaveBeenCalled();
    // The registry is not even consulted once the user's own key answers.
    expect(mockFindPurpose).not.toHaveBeenCalled();
  });

  it("falls back to the system credential, tagged source 'system', when the user has none and a fallback is registered", async () => {
    userCredentials.getSecret.mockResolvedValue(null);
    mockFindPurpose.mockReturnValue(registryEntry());
    credentials.getSecret.mockResolvedValue('shared-key');

    const result = await resolver.resolve(USER_ID, 'llm', 'default');

    expect(result).toEqual({ secret: 'shared-key', source: 'system' });
    expect(credentials.getSecret).toHaveBeenCalledWith('llm', 'default');
  });

  it('returns null, and never queries the system store, when the purpose is not registered', async () => {
    userCredentials.getSecret.mockResolvedValue(null);
    mockFindPurpose.mockReturnValue(undefined);

    const result = await resolver.resolve(USER_ID, 'unregistered-purpose', 'default');

    expect(result).toBeNull();
    expect(credentials.getSecret).not.toHaveBeenCalled();
  });

  it('returns null when the registry entry declares systemFallback: null', async () => {
    userCredentials.getSecret.mockResolvedValue(null);
    mockFindPurpose.mockReturnValue(
      registryEntry({ purpose: 'byok-only', systemFallback: null }),
    );

    const result = await resolver.resolve(USER_ID, 'byok-only', 'default');

    expect(result).toBeNull();
    expect(credentials.getSecret).not.toHaveBeenCalled();
  });

  it('returns null when a fallback is declared but the system store has nothing configured at that address', async () => {
    userCredentials.getSecret.mockResolvedValue(null);
    mockFindPurpose.mockReturnValue(registryEntry());
    credentials.getSecret.mockResolvedValue(null);

    const result = await resolver.resolve(USER_ID, 'llm', 'default');

    expect(result).toBeNull();
  });

  it('resolves the SYSTEM store address named by the registry, not the caller\'s own purpose/name', async () => {
    userCredentials.getSecret.mockResolvedValue(null);
    mockFindPurpose.mockReturnValue(
      registryEntry({
        purpose: 'llm',
        systemFallback: { purpose: 'ai-shared', name: 'shared-default' },
      }),
    );
    credentials.getSecret.mockResolvedValue('shared-key');

    await resolver.resolve(USER_ID, 'llm', 'my-provider-name');

    expect(credentials.getSecret).toHaveBeenCalledWith(
      'ai-shared',
      'shared-default',
    );
  });

  it("the most important case: propagates the throw when the user's own credential exists but cannot be decrypted, and NEVER consults the system store", async () => {
    const decryptError = new Error(
      'Your stored credential "llm/default" could not be decrypted. It must be set again.',
    );
    userCredentials.getSecret.mockRejectedValue(decryptError);

    await expect(resolver.resolve(USER_ID, 'llm', 'default')).rejects.toThrow(
      decryptError,
    );

    // If this ever becomes a fallback to the system key, a user with a broken
    // (rotated-key, tampered-row) credential would silently start spending
    // the deployment's quota while believing they are on their own key.
    expect(credentials.getSecret).not.toHaveBeenCalled();
    expect(mockFindPurpose).not.toHaveBeenCalled();
  });

  it('an undecryptable SYSTEM credential also propagates rather than resolving to null', async () => {
    userCredentials.getSecret.mockResolvedValue(null);
    mockFindPurpose.mockReturnValue(registryEntry());
    const decryptError = new Error(
      'Credential "llm/default" could not be decrypted. It must be set again.',
    );
    credentials.getSecret.mockRejectedValue(decryptError);

    await expect(resolver.resolve(USER_ID, 'llm', 'default')).rejects.toThrow(
      decryptError,
    );
  });
});
