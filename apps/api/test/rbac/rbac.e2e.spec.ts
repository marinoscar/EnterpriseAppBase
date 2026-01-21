import request from 'supertest';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetDatabase } from '../helpers/database.helper';
import {
  createAdminUser,
  createContributorUser,
  createViewerUser,
  authHeader,
} from '../helpers/auth.helper';

describe('RBAC System (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  describe('Role-Based Access', () => {
    describe('Admin Role', () => {
      it('should have access to user management', async () => {
        const admin = await createAdminUser(context);

        const response = await request(context.app.getHttpServer())
          .get('/api/users')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data)).toBe(true);
      });

      it('should have access to system settings', async () => {
        const admin = await createAdminUser(context);

        const response = await request(context.app.getHttpServer())
          .get('/api/system-settings')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data).toBeDefined();
      });

      it('should be able to modify system settings', async () => {
        const admin = await createAdminUser(context);

        const response = await request(context.app.getHttpServer())
          .patch('/api/system-settings')
          .set(authHeader(admin.accessToken))
          .send({ ui: { allowUserThemeOverride: false } })
          .expect(200);

        expect(response.body.data).toBeDefined();
        expect(response.body.data.ui.allowUserThemeOverride).toBe(false);
      });

      it('should be able to modify user roles', async () => {
        const admin = await createAdminUser(context);
        const viewer = await createViewerUser(context);

        const contributorRole = await context.prisma.role.findUnique({
          where: { name: 'contributor' },
        });

        const response = await request(context.app.getHttpServer())
          .patch(`/api/users/${viewer.id}`)
          .set(authHeader(admin.accessToken))
          .send({ roleIds: [contributorRole!.id] })
          .expect(200);

        expect(response.body.data).toBeDefined();
        expect(response.body.data.userRoles).toBeDefined();
      });

      it('should be able to deactivate users', async () => {
        const admin = await createAdminUser(context);
        const viewer = await createViewerUser(context);

        const response = await request(context.app.getHttpServer())
          .patch(`/api/users/${viewer.id}`)
          .set(authHeader(admin.accessToken))
          .send({ isActive: false })
          .expect(200);

        expect(response.body.data.isActive).toBe(false);
      });
    });

    describe('Contributor Role', () => {
      it('should NOT have access to user management', async () => {
        const contributor = await createContributorUser(context);

        const response = await request(context.app.getHttpServer())
          .get('/api/users')
          .set(authHeader(contributor.accessToken))
          .expect(403);

        expect(response.body).toHaveProperty('code');
        expect(response.body.code).toBe('FORBIDDEN');
      });

      it('should NOT have access to system settings write', async () => {
        const contributor = await createContributorUser(context);

        const response = await request(context.app.getHttpServer())
          .patch('/api/system-settings')
          .set(authHeader(contributor.accessToken))
          .send({ ui: { allowUserThemeOverride: false } })
          .expect(403);

        expect(response.body.code).toBe('FORBIDDEN');
      });

      it('should have access to own user settings', async () => {
        const contributor = await createContributorUser(context);

        const response = await request(context.app.getHttpServer())
          .get('/api/user-settings')
          .set(authHeader(contributor.accessToken))
          .expect(200);

        expect(response.body.data).toBeDefined();
      });

      it('should be able to modify own user settings', async () => {
        const contributor = await createContributorUser(context);

        const response = await request(context.app.getHttpServer())
          .patch('/api/user-settings')
          .set(authHeader(contributor.accessToken))
          .send({ theme: 'dark' })
          .expect(200);

        expect(response.body.data.theme).toBe('dark');
      });

      it('should have access to own profile (auth/me)', async () => {
        const contributor = await createContributorUser(context);

        const response = await request(context.app.getHttpServer())
          .get('/api/auth/me')
          .set(authHeader(contributor.accessToken))
          .expect(200);

        expect(response.body.data.email).toBe(contributor.email);
      });
    });

    describe('Viewer Role', () => {
      it('should NOT have access to user management', async () => {
        const viewer = await createViewerUser(context);

        const response = await request(context.app.getHttpServer())
          .get('/api/users')
          .set(authHeader(viewer.accessToken))
          .expect(403);

        expect(response.body.code).toBe('FORBIDDEN');
      });

      it('should NOT have access to system settings', async () => {
        const viewer = await createViewerUser(context);

        const response = await request(context.app.getHttpServer())
          .patch('/api/system-settings')
          .set(authHeader(viewer.accessToken))
          .send({ ui: { allowUserThemeOverride: false } })
          .expect(403);

        expect(response.body.code).toBe('FORBIDDEN');
      });

      it('should have read access to own user settings', async () => {
        const viewer = await createViewerUser(context);

        const response = await request(context.app.getHttpServer())
          .get('/api/user-settings')
          .set(authHeader(viewer.accessToken))
          .expect(200);

        expect(response.body.data).toBeDefined();
      });

      it('should NOT be able to write own user settings', async () => {
        const viewer = await createViewerUser(context);

        const response = await request(context.app.getHttpServer())
          .patch('/api/user-settings')
          .set(authHeader(viewer.accessToken))
          .send({ theme: 'dark' })
          .expect(403);

        expect(response.body.code).toBe('FORBIDDEN');
      });

      it('should have access to own profile (auth/me)', async () => {
        const viewer = await createViewerUser(context);

        const response = await request(context.app.getHttpServer())
          .get('/api/auth/me')
          .set(authHeader(viewer.accessToken))
          .expect(200);

        expect(response.body.data.email).toBe(viewer.email);
      });
    });
  });

  describe('Permission-Based Access', () => {
    it('should allow users:read permission to list users', async () => {
      const admin = await createAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should allow users:write permission to modify users', async () => {
      const admin = await createAdminUser(context);
      const viewer = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .patch(`/api/users/${viewer.id}`)
        .set(authHeader(admin.accessToken))
        .send({ isActive: false })
        .expect(200);

      expect(response.body.data.isActive).toBe(false);
    });

    it('should deny without users:read permission', async () => {
      const viewer = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should deny without system_settings:write permission', async () => {
      const viewer = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .patch('/api/system-settings')
        .set(authHeader(viewer.accessToken))
        .send({ ui: { allowUserThemeOverride: true } })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should allow user_settings:read permission to read own settings', async () => {
      const contributor = await createContributorUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/user-settings')
        .set(authHeader(contributor.accessToken))
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('should allow user_settings:write permission to modify own settings', async () => {
      const contributor = await createContributorUser(context);

      const response = await request(context.app.getHttpServer())
        .patch('/api/user-settings')
        .set(authHeader(contributor.accessToken))
        .send({ theme: 'dark' })
        .expect(200);

      expect(response.body.data.theme).toBe('dark');
    });
  });

  describe('Guard Combination', () => {
    it('should require both role and permission when both specified', async () => {
      const admin = await createAdminUser(context);

      // Admin has both role and permissions
      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('should fail if role matches but permission missing', async () => {
      // Viewer has the viewer role but lacks users:read permission
      const viewer = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Self-Resource Access', () => {
    it('should allow user to access own settings regardless of role', async () => {
      const viewer = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/user-settings')
        .set(authHeader(viewer.accessToken))
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('should allow contributor to modify own settings', async () => {
      const contributor = await createContributorUser(context);

      const response = await request(context.app.getHttpServer())
        .patch('/api/user-settings')
        .set(authHeader(contributor.accessToken))
        .send({ theme: 'light' })
        .expect(200);

      expect(response.body.data.theme).toBe('light');
    });

    it('should allow user to access own profile', async () => {
      const viewer = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(viewer.accessToken))
        .expect(200);

      expect(response.body.data.id).toBe(viewer.id);
      expect(response.body.data.email).toBe(viewer.email);
    });
  });

  describe('Multiple Roles', () => {
    it('should aggregate permissions from multiple roles', async () => {
      // Create a user with both contributor and admin roles
      const email = 'multi-role@example.com';
      const adminRole = await context.prisma.role.findUnique({
        where: { name: 'admin' },
      });
      const contributorRole = await context.prisma.role.findUnique({
        where: { name: 'contributor' },
      });

      const user = await context.prisma.user.create({
        data: {
          email,
          providerDisplayName: 'Multi-Role User',
          identities: {
            create: {
              provider: 'google',
              providerSubject: `google-${Date.now()}`,
              providerEmail: email,
            },
          },
          userRoles: {
            create: [{ roleId: adminRole!.id }, { roleId: contributorRole!.id }],
          },
          userSettings: {
            create: {
              value: {
                theme: 'system',
                profile: { useProviderImage: true },
                updatedAt: new Date().toISOString(),
                version: 1,
              },
            },
          },
        },
      });

      const jwtService = context.module.get('JwtService');
      const accessToken = jwtService.sign({
        sub: user.id,
        email: user.email,
        roles: ['admin', 'contributor'],
      });

      // Should have admin permissions
      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(accessToken))
        .expect(200);

      expect(response.body.data).toBeDefined();
    });
  });
});
