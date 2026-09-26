import { http, HttpResponse } from 'msw';
import {
  mockAiAdminConfig,
  mockAiModelList,
  mockAiModels,
  mockAiProbeResultPassed,
  mockAiPublicConfigDisabled,
  mockAiResponse,
  mockAiRun,
  mockAiStreamEvents,
  mockUsableAiModels,
  mockUserAiKeys,
  toSseBody,
} from './fixtures/ai';

// Use wildcard pattern to match relative URLs
const API_BASE = '*/api';

// Mock data
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  profileImageUrl: null,
  roles: [{ name: 'viewer' }],
  permissions: ['user_settings:read', 'user_settings:write'],
  isActive: true,
  createdAt: new Date().toISOString(),
};

const mockUserSettings = {
  theme: 'system',
  profile: {
    displayName: null,
    imageSource: 'provider',
    imageObjectId: null,
  },
  updatedAt: new Date().toISOString(),
  version: 1,
};

const mockSystemSettings = {
  notifications: {
    browserEnabled: true,
    disabledEvents: [],
  },
  updatedAt: new Date().toISOString(),
  updatedBy: null,
  version: 1,
};

const mockProviders = [
  { name: 'google', authUrl: '/api/auth/google' },
];

export const handlers = [
  // Auth endpoints
  http.get(`${API_BASE}/auth/providers`, () => {
    // Real API returns { providers: [...] } which gets unwrapped by api.ts
    return HttpResponse.json({ providers: mockProviders });
  }),

  http.get(`${API_BASE}/auth/me`, () => {
    return HttpResponse.json({ data: mockUser });
  }),

  http.post(`${API_BASE}/auth/logout`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_BASE}/auth/refresh`, () => {
    return HttpResponse.json({
      accessToken: 'new-mock-token',
      expiresIn: 900,
    });
  }),

  // User settings endpoints
  http.get(`${API_BASE}/user-settings`, () => {
    return HttpResponse.json({ data: mockUserSettings });
  }),

  http.put(`${API_BASE}/user-settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      data: {
        ...mockUserSettings,
        ...body,
        version: mockUserSettings.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  http.patch(`${API_BASE}/user-settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      data: {
        ...mockUserSettings,
        ...body,
        version: mockUserSettings.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  // Profile picture endpoints (#367) — POST to upload, DELETE to remove.
  // Both return `{ settings, profileImageUrl }` after the client's `data` unwrap.
  http.post(`${API_BASE}/user-settings/profile-image`, () => {
    return HttpResponse.json({
      data: {
        settings: {
          ...mockUserSettings,
          profile: {
            ...mockUserSettings.profile,
            imageSource: 'upload',
            imageObjectId: 'mock-object-id',
          },
          version: mockUserSettings.version + 1,
          updatedAt: new Date().toISOString(),
        },
        profileImageUrl: 'https://example.com/uploaded-mock.jpg',
      },
    });
  }),

  http.delete(`${API_BASE}/user-settings/profile-image`, () => {
    return HttpResponse.json({
      data: {
        settings: {
          ...mockUserSettings,
          profile: {
            ...mockUserSettings.profile,
            imageSource: 'provider',
            imageObjectId: null,
          },
          version: mockUserSettings.version + 1,
          updatedAt: new Date().toISOString(),
        },
        profileImageUrl: null,
      },
    });
  }),

  // System settings endpoints
  http.get(`${API_BASE}/system-settings`, () => {
    return HttpResponse.json({ data: mockSystemSettings });
  }),

  http.patch(`${API_BASE}/system-settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      data: {
        ...mockSystemSettings,
        ...body,
        version: mockSystemSettings.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  http.put(`${API_BASE}/system-settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      data: {
        ...body,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
        version: 1,
      },
    });
  }),

  // Users endpoints
  http.get(`${API_BASE}/users`, () => {
    return HttpResponse.json({
      items: [
        {
          id: mockUser.id,
          email: mockUser.email,
          displayName: mockUser.displayName,
          providerDisplayName: 'Test User (Provider)',
          profileImageUrl: mockUser.profileImageUrl,
          providerProfileImageUrl: null,
          isActive: mockUser.isActive,
          roles: mockUser.roles.map((r) => r.name),
          createdAt: mockUser.createdAt,
          updatedAt: mockUser.createdAt,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
  }),

  http.get(`${API_BASE}/users/:id`, ({ params }) => {
    if (params.id === mockUser.id) {
      return HttpResponse.json({ data: mockUser });
    }
    return new HttpResponse(null, { status: 404 });
  }),

  http.patch(`${API_BASE}/users/:id`, async ({ params, request }) => {
    if (params.id === mockUser.id) {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        id: mockUser.id,
        email: mockUser.email,
        displayName: (body.displayName as string | null) ?? mockUser.displayName,
        providerDisplayName: 'Test User (Provider)',
        profileImageUrl: mockUser.profileImageUrl,
        providerProfileImageUrl: null,
        isActive: body.isActive !== undefined ? (body.isActive as boolean) : mockUser.isActive,
        roles: mockUser.roles.map((r) => r.name),
        createdAt: mockUser.createdAt,
        updatedAt: new Date().toISOString(),
      });
    }
    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  }),

  http.put(`${API_BASE}/users/:id/roles`, async ({ params, request }) => {
    if (params.id === mockUser.id) {
      const body = (await request.json()) as { roles: string[] };
      return HttpResponse.json({
        id: mockUser.id,
        email: mockUser.email,
        displayName: mockUser.displayName,
        providerDisplayName: 'Test User (Provider)',
        profileImageUrl: mockUser.profileImageUrl,
        providerProfileImageUrl: null,
        isActive: mockUser.isActive,
        roles: body.roles,
        createdAt: mockUser.createdAt,
        updatedAt: new Date().toISOString(),
      });
    }
    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  }),

  // Health endpoints
  http.get(`${API_BASE}/health/live`, () => {
    return HttpResponse.json({
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    });
  }),

  http.get(`${API_BASE}/health/ready`, () => {
    return HttpResponse.json({
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'ok',
        },
      },
    });
  }),

  // Device Authorization endpoints
  http.get(`${API_BASE}/auth/device/activate`, ({ request }) => {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    // Default success response
    return HttpResponse.json({
      data: {
        userCode: code || 'ABCD-1234',
        clientInfo: {
          deviceName: 'My Smart TV',
          userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
          ipAddress: '192.168.1.100',
        },
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
    });
  }),

  http.post(`${API_BASE}/auth/device/authorize`, async ({ request }) => {
    const body = (await request.json()) as { userCode: string; approve: boolean };

    return HttpResponse.json({
      data: {
        success: body.approve,
        message: body.approve
          ? 'Device authorized successfully!'
          : 'Device access denied.',
      },
    });
  }),

  // ===========================================================================
  // AI (issue #425, epic #419). Fixtures live in `./fixtures/ai.ts` so the page
  // stories (#429, #430, #434) reuse them. `GET /ai/config` defaults to AI
  // DISABLED — a fresh deployment; override it per test to switch AI on.
  // ===========================================================================

  http.get(`${API_BASE}/ai/config`, () => {
    return HttpResponse.json({ data: mockAiPublicConfigDisabled });
  }),

  http.get(`${API_BASE}/admin/ai/config`, () => {
    return HttpResponse.json({ data: mockAiAdminConfig });
  }),

  http.put(`${API_BASE}/admin/ai/config`, async ({ request }) => {
    const body = (await request.json()) as {
      enabled: boolean;
      keyPolicy: typeof mockAiAdminConfig.keyPolicy;
      logPromptContent: boolean;
      defaults: typeof mockAiAdminConfig.defaults;
      providers: Record<string, { enabled: boolean; baseUrl?: string }>;
    };
    const ifMatch = request.headers.get('If-Match');
    if (ifMatch !== null && Number(ifMatch) !== mockAiAdminConfig.version) {
      return HttpResponse.json(
        { code: 'VERSION_CONFLICT', message: 'Settings were changed by someone else' },
        { status: 409 },
      );
    }
    return HttpResponse.json({
      data: {
        ...mockAiAdminConfig,
        enabled: body.enabled,
        keyPolicy: body.keyPolicy,
        logPromptContent: body.logPromptContent,
        defaults: body.defaults,
        providers: mockAiAdminConfig.providers.map((provider) => ({
          ...provider,
          ...(body.providers[provider.id] ?? {}),
        })),
        version: mockAiAdminConfig.version + 1,
      },
    });
  }),

  http.put(`${API_BASE}/admin/ai/providers/:provider/key`, () => {
    return HttpResponse.json({ data: mockAiAdminConfig });
  }),

  http.delete(`${API_BASE}/admin/ai/providers/:provider/key`, () => {
    return HttpResponse.json({
      data: {
        ...mockAiAdminConfig,
        providers: mockAiAdminConfig.providers.map((provider) => ({
          ...provider,
          keyStatus: { configured: false, hint: null, updatedAt: null, updatedByUserId: null },
        })),
      },
    });
  }),

  http.post(`${API_BASE}/admin/ai/providers/:provider/test`, () => {
    // Always 200 — the outcome is in the body.
    return HttpResponse.json({ data: mockAiProbeResultPassed });
  }),

  http.get(`${API_BASE}/admin/ai/models`, () => {
    return HttpResponse.json({ data: mockAiModelList });
  }),

  http.post(`${API_BASE}/admin/ai/models/refresh`, () => {
    return HttpResponse.json({ data: { jobId: 'job-ai-refresh-1' } });
  }),

  http.patch(`${API_BASE}/admin/ai/models/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const model = mockAiModels.find((entry) => entry.id === params.id);
    if (!model) {
      return HttpResponse.json({ code: 'NOT_FOUND', message: 'Model not found' }, { status: 404 });
    }
    return HttpResponse.json({
      data: {
        ...model,
        ...body,
        ...(body.capabilities ? { capabilitySource: 'admin_override' } : {}),
      },
    });
  }),

  http.get(`${API_BASE}/ai/keys`, () => {
    return HttpResponse.json({ data: mockUserAiKeys });
  }),

  http.put(`${API_BASE}/ai/keys/:provider`, ({ params }) => {
    return HttpResponse.json({
      data: { ...mockUserAiKeys[0], provider: String(params.provider) },
    });
  }),

  http.delete(`${API_BASE}/ai/keys/:provider`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_BASE}/ai/keys/:provider/test`, () => {
    return HttpResponse.json({ data: mockAiProbeResultPassed });
  }),

  http.get(`${API_BASE}/ai/models`, () => {
    return HttpResponse.json({ data: mockUsableAiModels });
  }),

  http.post(`${API_BASE}/ai/responses/stream`, () => {
    return new HttpResponse(toSseBody(mockAiStreamEvents), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }),

  http.post(`${API_BASE}/ai/responses`, () => {
    return HttpResponse.json({ data: mockAiResponse });
  }),

  http.post(`${API_BASE}/ai/runs`, () => {
    return HttpResponse.json({ data: { runId: mockAiRun.id, jobId: 'job-ai-run-1' } }, { status: 202 });
  }),

  http.get(`${API_BASE}/ai/runs/:id`, ({ params }) => {
    return HttpResponse.json({ data: { ...mockAiRun, id: String(params.id) } });
  }),

  http.post(`${API_BASE}/ai/runs/:id/cancel`, ({ params }) => {
    return HttpResponse.json({
      data: { ...mockAiRun, id: String(params.id), status: 'cancelled', output: null },
    });
  }),
];
