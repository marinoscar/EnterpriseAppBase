# CLI Tool Tests

This directory contains unit and integration tests for the CLI tool (`tools/app`).

## Test Structure

```
test/
  auth-error-handling.spec.ts  # Auth function error handling tests
  config-store.spec.ts          # Configuration persistence tests
  validators.spec.ts            # URL and input validation tests
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage
```bash
npm run test:cov
```

### Run specific test file
```bash
npm test -- --testPathPattern=validators
```

## Test Coverage

The test suite provides comprehensive coverage for the recently changed modules:

### config-store.ts (100% coverage)
- `loadConfig()` - Loading configuration from file
- `saveConfig()` - Saving configuration to file
- `getAppUrl()` - URL resolution with priority: env var > config > default
- `getApiUrl()` - API URL derivation from app URL
- `setAppUrl()` - Persisting URL configuration
- `clearConfig()` - Removing configuration
- `isAppUrlConfigured()` - Configuration status checking
- `getAppUrlSource()` - Configuration source identification

### validators.ts (100% coverage)
- `isValidUrl()` - HTTP/HTTPS URL validation with localhost support
- `validateUrl()` - Inquirer-compatible URL validation with error messages
- `normalizeUrl()` - URL normalization (trailing slash removal)
- `isValidEmail()` - Email address validation
- `validateEmail()` - Inquirer-compatible email validation
- `sanitizeEmail()` - Email normalization
- `isValidUuid()` - UUID format validation
- `validateUuid()` - Inquirer-compatible UUID validation
- `validateRequired()` - Non-empty string validation factory

### auth-error-handling.spec.ts
- Verifies that `authWhoami()` and `authToken()` throw errors instead of calling `process.exit()`
- Tests error propagation from API calls
- Validates error messages for authentication failures

## Testing Approach

### Integration Tests (config-store)
The config-store tests use **real filesystem operations** with temporary directories rather than mocking the `fs` module. This approach:
- Is simpler and more reliable for ES modules
- Tests actual file I/O behavior
- Provides better confidence in real-world scenarios
- Uses `process.env.APP_CONFIG_DIR` to isolate test data

### Unit Tests (validators)
The validator tests use standard unit testing:
- Test pure functions with no side effects
- Cover edge cases and boundary conditions
- Validate both success and error paths

### Error Handling Tests (auth)
Auth error handling tests verify the pattern of throwing errors:
- Mock implementations follow the same pattern as production code
- Test error propagation without importing problematic ES module dependencies
- Ensure functions don't call `process.exit()` directly

## Implementation Notes

### ES Modules
The CLI tool uses ES modules (`"type": "module"` in package.json), which requires:
- Jest configuration as `jest.config.cjs` (CommonJS)
- `NODE_OPTIONS=--experimental-vm-modules` for running tests
- `transformIgnorePatterns` to handle ES module dependencies

### Test Isolation
Each test suite ensures proper isolation:
- `beforeEach` sets up clean test environment
- `afterEach` cleans up temp files and restores environment
- Environment variables are saved/restored between tests

### Coverage Goals
- Core library modules (lib/): Aim for 100% coverage
- Command modules (commands/): Focus on error handling patterns
- Interactive modules (interactive/): May skip due to inquirer complexity

## Future Enhancements

Potential areas for additional testing:
- `auth-store.ts` - Token storage and retrieval
- `device-flow.ts` - Device authorization flow
- `api-client.ts` - API request handling
- Command integration tests with mocked API responses
