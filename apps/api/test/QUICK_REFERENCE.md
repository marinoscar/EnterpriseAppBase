# Testing Quick Reference

## Cheat Sheet for Writing Integration Tests

### Basic Test Setup

```typescript
import request from 'supertest';
import { TestContext, createTestApp, closeTestApp } from './helpers/test-app.helper';
import { resetPrismaMock } from './mocks/prisma.mock';
import { setupBaseMocks } from './fixtures/mock-setup.helper';
import { createMockAdminUser, authHeader } from './helpers/auth-mock.helper';

describe('My Feature', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();    // REQUIRED: Reset all mocks
    setupBaseMocks();      // REQUIRED: Setup base data
  });

  it('should work', async () => {
    const admin = await createMockAdminUser(context);

    const response = await request(context.app.getHttpServer())
      .get('/api/my-endpoint')
      .set(authHeader(admin.accessToken))
      .expect(200);

    expect(response.body.data).toBeDefined();
  });
});
```

### Create Test Users

```typescript
import {
  createMockAdminUser,
  createMockContributorUser,
  createMockViewerUser,
  createMockInactiveUser,
  createMockTestUser,
  authHeader,
} from './helpers/auth-mock.helper';

// Pre-defined roles
const admin = await createMockAdminUser(context);
const contributor = await createMockContributorUser(context);
const viewer = await createMockViewerUser(context);
const inactive = await createMockInactiveUser(context);

// Custom user
const custom = await createMockTestUser(context, {
  email: 'custom@example.com',
  roleName: 'contributor',
  isActive: true,
});
```

### Mock Prisma Responses

#### Single Record
```typescript
import { createMockUser } from './fixtures/test-data.factory';

const user = createMockUser({ email: 'test@example.com' });
context.prisma.user.findUnique.mockResolvedValue(user);
```

#### List of Records
```typescript
import { setupMockUserList } from './fixtures/mock-setup.helper';

setupMockUserList([
  { email: 'user1@example.com', isActive: true },
  { email: 'user2@example.com', isActive: false },
]);

// Or manually:
context.prisma.user.findMany.mockResolvedValue([user1, user2]);
context.prisma.user.count.mockResolvedValue(2);
```

#### Create Operation
```typescript
import { createMockAllowedEmail } from './fixtures/test-data.factory';

const entry = createMockAllowedEmail({
  email: 'new@example.com',
  addedById: admin.id,
});

context.prisma.allowedEmail.findUnique.mockResolvedValue(null); // Not exists
context.prisma.allowedEmail.create.mockResolvedValue(entry);     // Created
```

#### Update Operation
```typescript
const updatedUser = createMockUser({
  id: viewer.id,
  displayName: 'New Name',
});

context.prisma.user.update.mockResolvedValue(updatedUser);
```

#### Delete Operation
```typescript
context.prisma.allowedEmail.findUnique.mockResolvedValue(entry);
context.prisma.allowedEmail.delete.mockResolvedValue(entry);
```

### Common Test Patterns

#### Test 401 (Unauthorized)
```typescript
it('should return 401 without auth', async () => {
  await request(context.app.getHttpServer())
    .get('/api/protected-endpoint')
    .expect(401);
});
```

#### Test 403 (Forbidden)
```typescript
it('should return 403 without permission', async () => {
  const viewer = await createMockViewerUser(context);

  await request(context.app.getHttpServer())
    .get('/api/admin-only')
    .set(authHeader(viewer.accessToken))
    .expect(403);
});
```

#### Test Success
```typescript
it('should succeed for admin', async () => {
  const admin = await createMockAdminUser(context);

  context.prisma.user.findMany.mockResolvedValue([]);
  context.prisma.user.count.mockResolvedValue(0);

  const response = await request(context.app.getHttpServer())
    .get('/api/users')
    .set(authHeader(admin.accessToken))
    .expect(200);

  expect(response.body.data.items).toEqual([]);
});
```

#### Test List with Filters
```typescript
it('should filter by isActive', async () => {
  const admin = await createMockAdminUser(context);

  setupMockUserList([
    { email: 'active@example.com', isActive: true },
    { email: 'inactive@example.com', isActive: false },
  ]);

  const response = await request(context.app.getHttpServer())
    .get('/api/users?isActive=true')
    .set(authHeader(admin.accessToken))
    .expect(200);

  expect(response.body.data.total).toBe(1);
});
```

#### Test Pagination
```typescript
it('should paginate results', async () => {
  const admin = await createMockAdminUser(context);

  const users = Array.from({ length: 15 }, (_, i) => ({
    email: `user${i}@example.com`,
  }));

  setupMockUserList(users);

  const response = await request(context.app.getHttpServer())
    .get('/api/users?page=2&pageSize=10')
    .set(authHeader(admin.accessToken))
    .expect(200);

  expect(response.body.data.page).toBe(2);
  expect(response.body.data.total).toBe(15);
});
```

#### Test Validation
```typescript
it('should validate email format', async () => {
  const admin = await createMockAdminUser(context);

  await request(context.app.getHttpServer())
    .post('/api/allowlist')
    .set(authHeader(admin.accessToken))
    .send({ email: 'invalid-email' })
    .expect(400);
});
```

#### Test Audit Events
```typescript
it('should create audit event', async () => {
  const admin = await createMockAdminUser(context);

  const entry = createMockAllowedEmail({
    email: 'test@example.com',
    addedById: admin.id,
  });

  context.prisma.allowedEmail.create.mockResolvedValue(entry);
  context.prisma.allowedEmail.findUnique.mockResolvedValue(null);

  await request(context.app.getHttpServer())
    .post('/api/allowlist')
    .set(authHeader(admin.accessToken))
    .send({ email: 'test@example.com' })
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

### Factory Functions

```typescript
import {
  createMockUser,
  createMockUserWithRelations,
  createMockUserIdentity,
  createMockUserRole,
  createMockUserSettings,
  createMockSystemSettings,
  createMockAllowedEmail,
  createMockAuditEvent,
  mockRoles,
  mockPermissions,
} from './fixtures/test-data.factory';

// Simple user
const user = createMockUser({
  email: 'test@example.com',
  isActive: true,
});

// User with roles and relations
const userWithRoles = createMockUserWithRelations({
  email: 'admin@example.com',
  roleName: 'admin',
});

// Allowlist entry
const entry = createMockAllowedEmail({
  email: 'allowed@example.com',
  addedById: admin.id,
  claimedById: null,
});

// Use pre-defined roles/permissions
const adminRole = mockRoles.admin;
const viewerRole = mockRoles.viewer;
const usersReadPerm = mockPermissions.usersRead;
```

### Setup Helpers

```typescript
import {
  setupBaseMocks,
  setupRoleMocks,
  setupMockUser,
  setupMockUserList,
  setupMockAllowedEmail,
  setupMockAllowedEmailList,
  setupMockSystemSettings,
  setupMockAuditEvents,
} from './fixtures/mock-setup.helper';

beforeEach(() => {
  resetPrismaMock();

  // Setup all base mocks (roles, permissions, system settings, audit)
  setupBaseMocks();

  // Or setup individually:
  setupRoleMocks();
  setupMockSystemSettings();
  setupMockAuditEvents();
});
```

### Custom Mock Implementations

```typescript
// Complex filter logic
context.prisma.user.findMany.mockImplementation(async ({ where }) => {
  let users = allMockUsers;

  if (where?.isActive !== undefined) {
    users = users.filter(u => u.isActive === where.isActive);
  }

  if (where?.email?.contains) {
    const search = where.email.contains.toLowerCase();
    users = users.filter(u => u.email.toLowerCase().includes(search));
  }

  if (where?.userRoles?.some) {
    // Role filtering logic
  }

  return users;
});
```

### Debugging Tips

```typescript
// See what Prisma methods were called
console.log(context.prisma.user.findMany.mock.calls);

// See what was passed to a method
console.log(context.prisma.user.update.mock.calls[0][0]);

// Check if method was called
expect(context.prisma.user.create).toHaveBeenCalled();

// Check call count
expect(context.prisma.auditEvent.create).toHaveBeenCalledTimes(1);
```

## Don't Forget

1. **Always** call `resetPrismaMock()` in `beforeEach()`
2. **Always** call `setupBaseMocks()` in `beforeEach()`
3. **Never** create real database records in integration tests
4. Use `setupMockUserList()` when testing list endpoints
5. Mock Prisma responses BEFORE making HTTP requests
6. Use factories from `test-data.factory.ts` for consistent test data

## Examples

See these files for complete examples:
- `test/allowlist.integration.spec.ts` - CRUD operations
- `test/users.integration.spec.ts` - Complex filtering
- `test/rbac/rbac.integration.spec.ts` - RBAC testing
- `test/auth/auth.integration.spec.ts` - Auth endpoints
