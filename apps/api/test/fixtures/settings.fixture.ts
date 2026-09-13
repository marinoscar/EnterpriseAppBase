export const userSettingsFixtures = {
  default: {
    theme: 'system',
    profile: {
      useProviderImage: true,
    },
    updatedAt: new Date().toISOString(),
    version: 1,
  },

  darkTheme: {
    theme: 'dark',
    profile: {
      useProviderImage: true,
    },
    updatedAt: new Date().toISOString(),
    version: 1,
  },

  customProfile: {
    theme: 'light',
    profile: {
      displayName: 'Custom Name',
      useProviderImage: false,
      customImageUrl: 'https://example.com/custom.jpg',
    },
    updatedAt: new Date().toISOString(),
    version: 1,
  },
};

export const systemSettingsFixtures = {
  default: {
    notifications: {
      browserEnabled: true,
      disabledEvents: [],
    },
    updatedAt: new Date().toISOString(),
    updatedBy: null,
    version: 1,
  },

  restrictive: {
    notifications: {
      browserEnabled: false,
      disabledEvents: ['security.role_changed'],
    },
    updatedAt: new Date().toISOString(),
    updatedBy: null,
    version: 1,
  },
};
