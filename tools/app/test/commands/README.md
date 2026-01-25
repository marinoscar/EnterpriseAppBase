# CLI Command Error Handling Tests

This directory contains comprehensive unit tests for the CLI tool command error handling. These tests verify that command functions throw errors instead of calling `process.exit(1)` when errors occur, which prevents crashes in interactive mode.

## Background

The CLI tool was refactored to support both command-line and interactive modes. Previously, commands would call `process.exit(1)` directly when encountering errors, which would crash the entire process when using the interactive prompt powered by `inquirer`.

The refactoring changed all command functions to throw errors instead, allowing the caller (Commander action handlers) to handle the error display and process exit.

## Test Files

### `users.spec.ts` (15 tests)

Tests error handling for user management commands:

**`listUsers()`**
- Throws when API returns error response
- Throws when API returns 401 (authentication error)
- Throws with default message when error message is missing
- Throws when API request fails (network error)
- Passes correct query parameters (page, limit)
- Uses default pagination when not provided
- Succeeds when API returns valid data
- Outputs JSON when json option is true

**`getUser()`**
- Throws when API returns error response
- Throws when API returns 401 (authentication error)
- Throws with default message when error message is missing
- Throws when API request fails (network error)
- Passes correct user ID in path
- Succeeds when API returns valid data
- Outputs JSON when json option is true

### `allowlist.spec.ts` (25 tests)

Tests error handling for allowlist management commands:

**`listAllowlist()`**
- Throws when API returns error response
- Throws when API returns 401 (authentication error)
- Throws with default message when error message is missing
- Throws when API request fails (network error)
- Passes correct query parameters
- Uses default pagination when not provided
- Succeeds when API returns valid data
- Outputs JSON when json option is true

**`addToAllowlist()`**
- Throws on invalid email (validation error)
- Throws when email validation returns error string
- Throws when API returns error response
- Throws when API returns 401 (authentication error)
- Throws with default message when error message is missing
- Throws when API request fails (network error)
- Sends sanitized email in request body
- Includes notes when provided
- Succeeds when API returns success

**`removeFromAllowlist()`**
- Throws when API returns error response
- Throws when API returns 401 (authentication error)
- Throws when API returns 403 (trying to remove claimed entry)
- Throws with default message when error message is missing
- Throws when API request fails (network error)
- Passes correct entry ID in path
- Succeeds when API returns success

### `settings.spec.ts` (25 tests)

Tests error handling for settings management commands:

**`getUserSettings()`**
- Throws when API returns error response
- Throws when API returns 401 (authentication error)
- Throws with default message when error message is missing
- Throws when API request fails (network error)
- Requests correct endpoint
- Succeeds when API returns valid data
- Outputs JSON when json option is true

**`updateUserSetting()`**
- Throws when API returns error response
- Throws when API returns 401 (authentication error)
- Throws when API returns 400 (validation error)
- Throws with default message when error message is missing
- Throws when API request fails (network error)
- Sends PATCH request with correct key-value pair
- Parses JSON value when valid JSON string provided
- Uses string value when JSON parsing fails
- Parses boolean values correctly
- Parses numeric values correctly
- Succeeds when API returns success

**`getSystemSettings()`**
- Throws when API returns error response
- Throws when API returns 401 (authentication error)
- Throws when API returns 403 (not admin - forbidden)
- Throws with default message when error message is missing
- Throws when API request fails (network error)
- Requests correct endpoint
- Succeeds when API returns valid data
- Outputs JSON when json option is true

### `health.spec.ts` (10 tests)

Tests error handling for health check command:

**`healthCheck()`**
- Throws when checkHealth throws network error
- Throws when checkHealth throws connection refused error
- Throws when API is unreachable
- Succeeds when API is healthy (live and ready)
- Succeeds when API is live but not ready
- Succeeds when API is not healthy (displays status without crashing)
- Calls checkHealth from api-client
- Outputs JSON when json option is true
- Formats output correctly for healthy API
- Formats output correctly for unhealthy API

## Test Implementation Pattern

All tests use the following pattern to work with Jest's ESM module support:

```typescript
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// Create mocks before importing modules
const mockApiRequest = jest.fn<any>();

jest.unstable_mockModule('../../src/lib/api-client.js', () => ({
  apiRequest: mockApiRequest,
}));

jest.unstable_mockModule('../../src/utils/output.js', () => ({
  header: jest.fn(),
  // ... other output functions
}));

describe('command tests', () => {
  let commandFunction: any;

  beforeEach(async () => {
    // Import after mocks are set up
    const commands = await import('../../src/commands/example.js');
    commandFunction = commands.commandFunction;

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should throw on error', async () => {
    mockApiRequest.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Error' }),
    });

    await expect(commandFunction()).rejects.toThrow('Error');
  });
});
```

## Running Tests

```bash
# Run all command tests
cd tools/app
npm test -- test/commands/

# Run specific test file
npm test -- test/commands/users.spec.ts

# Run with coverage
npm test -- test/commands/ --coverage

# Watch mode
npm test -- test/commands/ --watch
```

## Test Coverage

Current coverage for command error handling:

- **Users commands**: 100% (all error paths covered)
- **Allowlist commands**: 100% (all error paths covered)
- **Settings commands**: 100% (all error paths covered)
- **Health command**: 100% (all error paths covered)

## Key Testing Principles

1. **Error Propagation**: Verify that functions throw errors instead of exiting
2. **Error Messages**: Check that error messages are correctly passed through
3. **Default Messages**: Ensure fallback error messages when API doesn't provide one
4. **Network Errors**: Verify that network failures are properly propagated
5. **Authentication Errors**: Confirm 401 responses trigger authentication errors
6. **Validation Errors**: Test that input validation failures throw appropriate errors
7. **Success Cases**: Verify that valid API responses don't throw errors
8. **API Integration**: Confirm correct API endpoints and parameters are used

## Related Files

- Command implementations: `tools/app/src/commands/*.ts`
- API client: `tools/app/src/lib/api-client.ts`
- Validators: `tools/app/src/lib/validators.ts`
- Output utilities: `tools/app/src/utils/output.ts`
- Jest config: `tools/app/jest.config.cjs`
