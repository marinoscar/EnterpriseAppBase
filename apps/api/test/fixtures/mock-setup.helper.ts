import { prismaMock } from '../mocks/prisma.mock';
import {
  createMockUser,
  createMockUserWithRelations,
  createMockAllowedEmail,
  createMockAuditEvent,
  createMockSystemSettings,
  mockRoles,
  mockPermissions,
  CreateMockUserOptions,
  CreateMockAllowedEmailOptions,
} from './test-data.factory';

/**
 * Mock setup helpers to configure Prisma mock responses
 * Use these to set up test scenarios without database calls
 */

// ============================================================================
// Role and Permission Mocks
// ============================================================================

export function setupRoleMocks(): void {
  // Mock role.findUnique - use mockResolvedValue for each call
  (prismaMock.role.findUnique as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      if (where.name) {
        return mockRoles[where.name as keyof typeof mockRoles] || null;
      }
      if (where.id) {
        const role = Object.values(mockRoles).find((r) => r.id === where.id);
        return role || null;
      }
      return null;
    },
  );

  // Mock role.findMany
  (prismaMock.role.findMany as jest.Mock).mockResolvedValue(
    Object.values(mockRoles),
  );

  // Mock permission.findUnique
  (prismaMock.permission.findUnique as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      if (where.name) {
        const permission = Object.values(mockPermissions).find(
          (p) => p.name === where.name,
        );
        return permission || null;
      }
      return null;
    },
  );

  // Mock permission.findMany
  (prismaMock.permission.findMany as jest.Mock).mockResolvedValue(
    Object.values(mockPermissions),
  );
}

// ============================================================================
// User Mocks
// ============================================================================

export interface SetupMockUserResponse {
  id: string;
  email: string;
  roles: string[];
}

// Registry of mock users - accumulates users across multiple setupMockUser calls
let mockUserRegistry: Map<string, any> = new Map();

/**
 * Clear the mock user registry
 * Call this in beforeEach() along with resetPrismaMock()
 */
export function clearMockUserRegistry(): void {
  mockUserRegistry = new Map();
}

/**
 * Setup the user mock implementations
 * This should be called once in beforeEach after clearing the registry
 */
export function setupUserMocks(): void {
  // Mock user.findUnique - searches the registry
  (prismaMock.user.findUnique as jest.Mock).mockImplementation(
    async ({ where, include }: any) => {
      // Search by id
      if (where.id && mockUserRegistry.has(where.id)) {
        return mockUserRegistry.get(where.id);
      }
      // Search by email
      for (const user of mockUserRegistry.values()) {
        if (where.email === user.email) {
          return user;
        }
      }
      return null;
    },
  );

  // Mock user.update - updates user in registry
  (prismaMock.user.update as jest.Mock).mockImplementation(
    async ({ where, data }: any) => {
      const user = mockUserRegistry.get(where.id);
      if (user) {
        const updated = { ...user, ...data };
        mockUserRegistry.set(where.id, updated);
        return updated;
      }
      // Search by email
      for (const [id, u] of mockUserRegistry.entries()) {
        if (where.email === u.email) {
          const updated = { ...u, ...data };
          mockUserRegistry.set(id, updated);
          return updated;
        }
      }
      throw new Error('User not found');
    },
  );
}

/**
 * Setup a mock user in the Prisma mock
 * Returns the user data that will be "found" by Prisma queries
 * Supports multiple users - each call adds to the registry
 */
export function setupMockUser(
  options: CreateMockUserOptions = {},
): SetupMockUserResponse {
  const user = createMockUserWithRelations(options);

  // Add user to registry
  mockUserRegistry.set(user.id, user);

  const roles = user.userRoles?.map((ur: any) => ur.role.name) || [];

  return {
    id: user.id,
    email: user.email,
    roles,
  };
}

/**
 * Setup multiple mock users for list queries
 */
export function setupMockUserList(
  users: Array<CreateMockUserOptions>,
): SetupMockUserResponse[] {
  const mockUsers = users.map((opts) => createMockUserWithRelations(opts));

  // Mock user.findMany
  (prismaMock.user.findMany as jest.Mock).mockImplementation(
    async (args: any) => {
      const where = args?.where;
      const include = args?.include;
      let filtered = mockUsers;

      // Apply filters
      if (where) {
        if (where.isActive !== undefined) {
          filtered = filtered.filter((u) => u.isActive === where.isActive);
        }
        if (
          where.email &&
          typeof where.email === 'object' &&
          'contains' in where.email
        ) {
          const search = where.email.contains.toLowerCase();
          filtered = filtered.filter((u: any) =>
            u.email.toLowerCase().includes(search),
          );
        }
        if (where.userRoles && 'some' in where.userRoles) {
          const roleFilter = where.userRoles.some;
          if (roleFilter?.role?.name) {
            filtered = filtered.filter((u: any) =>
              u.userRoles?.some(
                (ur: any) => ur.role.name === roleFilter.role.name,
              ),
            );
          }
        }
      }

      return filtered;
    },
  );

  // Mock user.count
  (prismaMock.user.count as jest.Mock).mockImplementation(async (args: any) => {
    const where = args?.where;
    let filtered = mockUsers;

    if (where) {
      if (where.isActive !== undefined) {
        filtered = filtered.filter((u) => u.isActive === where.isActive);
      }
      if (
        where.email &&
        typeof where.email === 'object' &&
        'contains' in where.email
      ) {
        const search = where.email.contains.toLowerCase();
        filtered = filtered.filter((u: any) =>
          u.email.toLowerCase().includes(search),
        );
      }
    }

    return filtered.length;
  });

  return mockUsers.map((user: any) => ({
    id: user.id,
    email: user.email,
    roles: user.userRoles?.map((ur: any) => ur.role.name) || [],
  }));
}

// ============================================================================
// Allowlist Mocks
// ============================================================================

export function setupMockAllowedEmail(
  options: CreateMockAllowedEmailOptions,
): void {
  const allowedEmail = createMockAllowedEmail(options);

  (prismaMock.allowedEmail.findUnique as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      if (where.email === allowedEmail.email || where.id === allowedEmail.id) {
        return allowedEmail;
      }
      return null;
    },
  );

  (prismaMock.allowedEmail.create as jest.Mock).mockResolvedValue(allowedEmail);
}

export function setupMockAllowedEmailList(
  allowedEmails: Array<CreateMockAllowedEmailOptions>,
): void {
  const mockEmails = allowedEmails.map((opts) => createMockAllowedEmail(opts));

  (prismaMock.allowedEmail.findMany as jest.Mock).mockImplementation(
    async (args: any) => {
      const where = args?.where;
      let filtered = mockEmails;

      // Apply filters
      if (where) {
        if (
          where.email &&
          typeof where.email === 'object' &&
          'contains' in where.email
        ) {
          const search = where.email.contains.toLowerCase();
          filtered = filtered.filter((e) => e.email.includes(search));
        }
        if (where.claimedById === null) {
          // Status: pending
          filtered = filtered.filter((e) => e.claimedById === null);
        } else if (where.claimedById && 'not' in where.claimedById) {
          // Status: claimed
          filtered = filtered.filter((e) => e.claimedById !== null);
        }
      }

      return filtered;
    },
  );

  (prismaMock.allowedEmail.count as jest.Mock).mockImplementation(
    async (args: any) => {
      const where = args?.where;
      let filtered = mockEmails;

      if (where) {
        if (
          where.email &&
          typeof where.email === 'object' &&
          'contains' in where.email
        ) {
          const search = where.email.contains.toLowerCase();
          filtered = filtered.filter((e) => e.email.includes(search));
        }
        if (where.claimedById === null) {
          filtered = filtered.filter((e) => e.claimedById === null);
        } else if (where.claimedById && 'not' in where.claimedById) {
          filtered = filtered.filter((e) => e.claimedById !== null);
        }
      }

      return filtered.length;
    },
  );
}

// ============================================================================
// System Settings Mocks
// ============================================================================

export function setupMockSystemSettings(): void {
  const settings = createMockSystemSettings();

  (prismaMock.systemSettings.findUnique as jest.Mock).mockResolvedValue(
    settings,
  );
  (prismaMock.systemSettings.upsert as jest.Mock).mockImplementation(
    async ({ create, update }: any) => {
      return { ...settings, ...create, ...update };
    },
  );
  (prismaMock.systemSettings.update as jest.Mock).mockImplementation(
    async ({ data }: any) => {
      return { ...settings, ...data };
    },
  );
}

// ============================================================================
// Audit Event Mocks
// ============================================================================

export function setupMockAuditEvents(): void {
  const auditEvents: any[] = [];

  (prismaMock.auditEvent.create as jest.Mock).mockImplementation(
    async ({ data }: any) => {
      const event = createMockAuditEvent(data);
      auditEvents.push(event);
      return event;
    },
  );

  (prismaMock.auditEvent.findFirst as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      if (!where) return auditEvents[0] || null;

      return (
        auditEvents.find((event) => {
          let matches = true;
          if (where.actorUserId)
            matches &&= event.actorUserId === where.actorUserId;
          if (where.action) matches &&= event.action === where.action;
          if (where.targetId) matches &&= event.targetId === where.targetId;
          return matches;
        }) || null
      );
    },
  );
}

// ============================================================================
// User Settings Mocks
// ============================================================================

// Registry for user settings
let mockUserSettingsRegistry: Map<string, any> = new Map();

/**
 * Setup user settings mocks that work with the user registry
 */
export function setupUserSettingsMocks(): void {
  mockUserSettingsRegistry = new Map();

  (prismaMock.userSettings.findUnique as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      // Check custom settings first
      if (mockUserSettingsRegistry.has(where.userId)) {
        return mockUserSettingsRegistry.get(where.userId);
      }
      // Fall back to user's default settings from registry
      const user = mockUserRegistry.get(where.userId);
      if (user?.userSettings) {
        return user.userSettings;
      }
      // Create default settings
      return {
        id: `settings-${where.userId}`,
        userId: where.userId,
        value: { theme: 'system' },
        version: 1,
        updatedAt: new Date(),
      };
    },
  );

  (prismaMock.userSettings.update as jest.Mock).mockImplementation(
    async ({ where, data }: any) => {
      const existing = mockUserSettingsRegistry.get(where.userId) || {
        id: `settings-${where.userId}`,
        userId: where.userId,
        value: { theme: 'system' },
        version: 1,
        updatedAt: new Date(),
      };
      const updated = {
        ...existing,
        value: data.value ?? existing.value,
        version: data.version ?? existing.version,
        updatedAt: new Date(),
      };
      mockUserSettingsRegistry.set(where.userId, updated);
      return updated;
    },
  );

  (prismaMock.userSettings.upsert as jest.Mock).mockImplementation(
    async ({ where, create, update }: any) => {
      const existing = mockUserSettingsRegistry.get(where.userId);
      if (existing) {
        const updated = { ...existing, ...update };
        mockUserSettingsRegistry.set(where.userId, updated);
        return updated;
      }
      const created = {
        id: `settings-${where.userId}`,
        userId: where.userId,
        ...create,
        updatedAt: new Date(),
      };
      mockUserSettingsRegistry.set(where.userId, created);
      return created;
    },
  );
}

/**
 * Set custom settings for a specific user
 */
export function setupMockUserSettings(userId: string, settings: any): void {
  mockUserSettingsRegistry.set(userId, {
    id: `settings-${userId}`,
    userId,
    value: settings,
    version: 1,
    updatedAt: new Date(),
  });
}

// ============================================================================
// Complete Mock Setup
// ============================================================================

/**
 * Setup all base mocks needed for most tests
 * Call this in beforeEach() after resetPrismaMock()
 */
export function setupBaseMocks(): void {
  // Clear registries
  clearMockUserRegistry();

  // Setup base mocks
  setupRoleMocks();
  setupUserMocks();
  setupUserSettingsMocks();
  setupMockSystemSettings();
  setupMockAuditEvents();

  // Mock $connect and $disconnect
  (prismaMock.$connect as jest.Mock).mockResolvedValue(undefined);
  (prismaMock.$disconnect as jest.Mock).mockResolvedValue(undefined);
}
