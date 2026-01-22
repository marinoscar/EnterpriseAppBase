# Testing Refactor: Database-Free Integration Tests

## Overview

This refactor converts E2E tests that previously required a real PostgreSQL database into **integration tests** that use mocked Prisma responses. This approach provides several benefits:

- **No database required** - Tests run without PostgreSQL connection
- **Faster execution** - No actual database I/O
- **Better isolation** - Each test is independent
- **Easier CI/CD** - No need to provision test databases
- **Predictable** - Mocked responses are consistent

## What Changed

### Before (E2E Tests with Database)
```typescript
// apps/api/test/users.e2e.spec.ts
beforeEach(async () => {
  await resetDatabase(context.prisma); // Real DB cleanup
});

it('should create user', async () => {
  const admin = await createAdminUser(context); // Creates real DB record

  // Test makes actual HTTP request
  // Database is queried and modified
});
```

### After (Integration Tests with Mocks)
```typescript
// apps/api/test/users.integration.spec.ts
beforeEach(async () => {
  resetPrismaMock(); // Reset mock state
  setupBaseMocks(); // Setup base mock responses
});

it('should create user', async () => {
  const admin = await createMockAdminUser(context); // Sets up mock data

  // Test makes HTTP request
  // Prisma calls return mocked responses
  // No database interaction
});
```

## New Test Infrastructure

### 1. Mock Prisma Client (`test/mocks/prisma.mock.ts`)
```typescript
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';

// Global mock instance
prismaMock.user.findUnique.mockResolvedValue(mockUser);
```

### 2. Test Data Factories (`test/fixtures/test-data.factory.ts`)
```typescript
import { createMockUser, createMockUserWithRelations } from '../fixtures/test-data.factory';

const user = createMockUser({ email: 'test@example.com', isActive: true });
const userWithRoles = createMockUserWithRelations({ roleName: 'admin' });
```

### 3. Mock Setup Helpers (`test/fixtures/mock-setup.helper.ts`)
```typescript
import { setupMockUser, setupMockUserList } from '../fixtures/mock-setup.helper';

// Setup single user
setupMockUser({ email: 'admin@example.com', roleName: 'admin' });

// Setup multiple users for list queries
setupMockUserList([
  { email: 'user1@example.com' },
  { email: 'user2@example.com' },
]);
```

### 4. Auth Mock Helpers (`test/helpers/auth-mock.helper.ts`)
```typescript
import { createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';

const admin = await createMockAdminUser(context);
// Returns: { id, email, roles, accessToken }
// No database record created
```

### 5. Updated Test App Helper (`test/helpers/test-app.helper.ts`)
```typescript
// Now defaults to mocked database
const context = await createTestApp({ useMockDatabase: true }); // default

// For true E2E tests (rare), use real DB
const context = await createTestApp({ useMockDatabase: false });
```

## Migration Guide

### Step 1: Update Imports
```typescript
// OLD
import { resetDatabase } from './helpers/database.helper';
import { createAdminUser, createViewerUser } from './helpers/auth.helper';

// NEW
import { resetPrismaMock } from './mocks/prisma.mock';
import { setupBaseMocks } from './fixtures/mock-setup.helper';
import { createMockAdminUser, createMockViewerUser } from './helpers/auth-mock.helper';
```

### Step 2: Update beforeEach
```typescript
// OLD
beforeEach(async () => {
  await resetDatabase(context.prisma);
});

// NEW
beforeEach(async () => {
  resetPrismaMock();
  setupBaseMocks();
});
```

### Step 3: Use Mock User Helpers
```typescript
// OLD
const admin = await createAdminUser(context);
const viewer = await createViewerUser(context);

// NEW
const admin = await createMockAdminUser(context);
const viewer = await createMockViewerUser(context);
```

### Step 4: Setup Mock Data for List Queries
```typescript
// OLD - Data was automatically in DB
const response = await request(app).get('/api/users');

// NEW - Setup mock data first
setupMockUserList([
  { email: 'user1@example.com' },
  { email: 'user2@example.com' },
]);

const response = await request(app).get('/api/users');
```

### Step 5: Mock Specific Prisma Responses
```typescript
// For operations that modify data
it('should update user', async () => {
  const admin = await createMockAdminUser(context);
  const viewer = await createMockViewerUser(context);

  const updatedUser = createMockUser({
    id: viewer.id,
    displayName: 'New Name',
  });

  context.prisma.user.update.mockResolvedValue(updatedUser);

  const response = await request(app)
    .patch(`/api/users/${viewer.id}`)
    .set(authHeader(admin.accessToken))
    .send({ displayName: 'New Name' })
    .expect(200);

  expect(response.body.data.displayName).toBe('New Name');
});
```

## Refactored Test Files

### Completed Refactors

| Old File | New File | Status |
|----------|----------|--------|
| `test/allowlist.e2e.spec.ts` | `test/allowlist.integration.spec.ts` | ✅ Complete |
| `test/users.e2e.spec.ts` | `test/users.integration.spec.ts` | ✅ Complete |
| `test/rbac/rbac.e2e.spec.ts` | `test/rbac/rbac.integration.spec.ts` | ✅ Complete |
| `test/rbac/guard-integration.e2e.spec.ts` | `test/rbac/guard-integration.integration.spec.ts` | ✅ Complete |

### Remaining Auth Tests (To Be Refactored)

These auth tests require special handling because they test OAuth flows:

- `test/auth/auth.e2e.spec.ts` - Auth endpoints
- `test/auth/oauth-flow.e2e.spec.ts` - OAuth user creation flow
- `test/auth/refresh-token.e2e.spec.ts` - Token refresh
- `test/auth/oauth-regressions.e2e.spec.ts` - OAuth edge cases
- `test/auth/allowlist-auth.e2e.spec.ts` - Allowlist integration

**Note**: These can be partially refactored, but some may need to remain as true E2E tests if they test complex OAuth state management.

## Common Patterns

### Pattern 1: Testing RBAC
```typescript
it('should deny viewer from accessing admin endpoint', async () => {
  const viewer = await createMockViewerUser(context);

  await request(context.app.getHttpServer())
    .get('/api/users')
    .set(authHeader(viewer.accessToken))
    .expect(403);
});
```

### Pattern 2: Testing List Queries with Filters
```typescript
it('should filter users by isActive', async () => {
  const admin = await createMockAdminUser(context);

  setupMockUserList([
    { email: 'active@example.com', isActive: true },
    { email: 'inactive@example.com', isActive: false },
  ]);

  const response = await request(app)
    .get('/api/users?isActive=true')
    .set(authHeader(admin.accessToken))
    .expect(200);

  expect(response.body.data.total).toBe(1);
});
```

### Pattern 3: Testing Create Operations
```typescript
it('should create allowlist entry', async () => {
  const admin = await createMockAdminUser(context);

  const mockEntry = createMockAllowedEmail({
    email: 'new@example.com',
    addedById: admin.id,
  });

  context.prisma.allowedEmail.create.mockResolvedValue(mockEntry);
  context.prisma.allowedEmail.findUnique.mockResolvedValue(null);

  const response = await request(app)
    .post('/api/allowlist')
    .set(authHeader(admin.accessToken))
    .send({ email: 'new@example.com' })
    .expect(201);

  expect(response.body.data.email).toBe('new@example.com');
});
```

### Pattern 4: Testing Audit Events
```typescript
it('should create audit event', async () => {
  const admin = await createMockAdminUser(context);

  await request(app)
    .post('/api/allowlist')
    .set(authHeader(admin.accessToken))
    .send({ email: 'audited@example.com' })
    .expect(201);

  expect(context.prisma.auditEvent.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: admin.id,
        action: 'allowlist:add',
      }),
    }),
  );
});
```

## Testing Commands

```bash
# Run all integration tests
cd apps/api && npm test

# Run specific test file
npm test -- allowlist.integration.spec.ts

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

## Benefits of This Approach

### 1. Speed
- **Before**: ~5-10 seconds per test suite (DB operations)
- **After**: <1 second per test suite (in-memory)

### 2. Reliability
- No flaky tests due to database state
- No race conditions from parallel test runs
- Predictable, reproducible results

### 3. Simplicity
- No database migrations needed for tests
- No test database cleanup
- No connection pooling issues

### 4. True Unit/Integration Testing
- Tests focus on business logic
- Database is treated as external dependency (mocked)
- Better separation of concerns

## When to Use Real Database Tests

Reserve true E2E tests (with real database) for:

1. **Migration testing** - Verify migrations work correctly
2. **Complex transactions** - Multi-step database operations
3. **Database-specific features** - Triggers, stored procedures, etc.
4. **Performance testing** - Actual query performance
5. **OAuth integration** - Full OAuth flow with state management

For most controller/service logic, mocked integration tests are sufficient and preferred.

## Troubleshooting

### Issue: Mock not returning expected data
```typescript
// Ensure you're setting up mocks BEFORE making the request
beforeEach(() => {
  resetPrismaMock();
  setupBaseMocks(); // This sets up roles, permissions, etc.
});

it('test', async () => {
  // Setup specific mocks for this test
  context.prisma.user.findUnique.mockResolvedValue(mockUser);

  // Now make request
  await request(app).get('/api/users/id');
});
```

### Issue: Tests pass individually but fail together
```typescript
// Make sure each test resets mocks
beforeEach(() => {
  resetPrismaMock(); // CRITICAL - resets all mock state
  setupBaseMocks();
});
```

### Issue: Complex Prisma queries not working
```typescript
// For complex queries, inspect what Prisma is being called with
it('test', async () => {
  // Make request
  await request(app).get('/api/users?filter=something');

  // See what was called
  console.log(context.prisma.user.findMany.mock.calls);

  // Setup mock to match the actual call
  context.prisma.user.findMany.mockImplementation(async ({ where }) => {
    // Custom logic based on where clause
    return filteredResults;
  });
});
```

## Next Steps

1. ✅ Infrastructure created (mocks, factories, helpers)
2. ✅ Core tests refactored (users, allowlist, RBAC)
3. ⏳ Refactor remaining auth tests
4. ⏳ Update CI/CD to remove database dependency
5. ⏳ Document patterns for future tests
6. ⏳ Consider deprecating old e2e test files

## Questions?

See existing refactored tests for examples:
- `test/allowlist.integration.spec.ts` - Full CRUD operations
- `test/users.integration.spec.ts` - Complex filtering and pagination
- `test/rbac/rbac.integration.spec.ts` - Permission testing
- `test/rbac/guard-integration.integration.spec.ts` - Guard behavior
