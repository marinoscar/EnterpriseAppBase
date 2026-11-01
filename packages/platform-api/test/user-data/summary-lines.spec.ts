// The lists the Danger Zone and the factory reset page print (PP-14.24): the
// platform's own lines are exactly what the web bundle used to hold, and a
// registered kept model or factory reset step adds one line when it carries a
// `summary`.

import { registerUserOwnedModels } from '../../src/core/index';
import { parsePrismaSchema } from '../../src/testing/index';
import {
  BUILT_IN_FACTORY_RESET_DELETED,
  BUILT_IN_FACTORY_RESET_KEPT,
  BUILT_IN_USER_DATA_KEPT,
  FactoryResetService,
  UserDataPlanService,
  UserDataService,
  factoryResetDeletedLines,
  factoryResetKeptLines,
  registerFactoryResetStep,
  registerPlatformUserData,
  registerUserDataModels,
  resolveUserDataModuleOptions,
  userDataKeptLines,
} from '../../src/user-data/index';
import { createFakeDb } from './fake-db';

const USER = '00000000-0000-4000-8000-0000000000a1';
const datamodel = parsePrismaSchema(`
model User { id String @id }
model Notification {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model Job { id String @id }
`);

// The text the web bundle's copy.ts printed before PP-14.24, verbatim.
const TODAY_USER_KEPT = [
  'Your account, your sign-in identities and your roles',
  'Your organization and group memberships',
  'This browser session (you stay signed in)',
  'The audit log',
];
const TODAY_FACTORY_DELETED = [
  'Every other user, their sessions and their access tokens',
  "Every user's data, yours included",
  'Job history, broadcasts, device logins and the allowlist (except your own entry)',
  'Every stored file except database backups',
  'Every organization except the default one',
];
const TODAY_FACTORY_KEPT = [
  'Your account and this session',
  'Roles and permissions',
  'Configuration: system settings, storage, email and AI credentials, AI models',
  'Database backups, their files and their jobs',
  'Worker nodes (reassigned to you)',
  'The audit log',
];

function services() {
  const fake = createFakeDb({
    user: [{ id: USER }],
    notification: [],
    job: [],
    organization: [{ id: 'def', name: 'Default', slug: 'default', isDefault: true }],
    membership: [],
    invite: [],
  });
  const options = resolveUserDataModuleOptions({ datamodel });
  const plans = new UserDataPlanService(options);
  const jobs = { enqueue: jest.fn() };
  const audit = { record: jest.fn(async () => undefined) };
  const environment = { deploymentMode: () => 'self-hosted' as const, tenancyMode: () => 'single' as const };
  return {
    user: new UserDataService(fake as any, plans, jobs as any, audit),
    factory: new FactoryResetService(fake as any, environment, plans, jobs as any, audit, options),
  };
}

beforeAll(() => {
  registerUserOwnedModels([{ model: 'Notification', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' }]);
  registerPlatformUserData();
});

describe('the platform lines', () => {
  it('are exactly the text the pages always printed', () => {
    expect([...BUILT_IN_USER_DATA_KEPT]).toEqual(TODAY_USER_KEPT);
    expect([...BUILT_IN_FACTORY_RESET_DELETED]).toEqual(TODAY_FACTORY_DELETED);
    expect([...BUILT_IN_FACTORY_RESET_KEPT]).toEqual(TODAY_FACTORY_KEPT);
  });

  it('are what the platform alone returns (its own kept models carry no summary)', async () => {
    expect(userDataKeptLines()).toEqual(TODAY_USER_KEPT);
    expect(factoryResetDeletedLines()).toEqual(TODAY_FACTORY_DELETED);
    expect(factoryResetKeptLines()).toEqual(TODAY_FACTORY_KEPT);
    const { user, factory } = services();
    expect((await user.summary(USER)).kept).toEqual(TODAY_USER_KEPT);
    const reset = await factory.summary(USER);
    expect(reset.deleted).toEqual(TODAY_FACTORY_DELETED);
    expect(reset.kept).toEqual(TODAY_FACTORY_KEPT);
  });
});

describe('what an app registers', () => {
  beforeAll(() => {
    registerUserDataModels([
      { model: 'SavedSearch', keep: 'Account preference the user keeps.', summary: 'Your saved searches' },
      { model: 'PlainKept', keep: 'Account state without a user-facing line.' },
      { model: 'Branding', factoryReset: 'keep', summary: 'Your brand kit' },
      { model: 'Duplicate', keep: 'Same line as another.', summary: 'Your saved searches' },
    ]);
    registerFactoryResetStep({
      id: 'custom-catalog',
      phase: 'before-users',
      summary: 'Every saved report and its schedule',
      run: async () => ({ rows: 0 }),
    });
    registerFactoryResetStep({ id: 'silent-step', phase: 'deployment', run: async () => ({ rows: 0 }) });
  });

  it('adds one line per kept model with a summary, after the platform lines, without duplicates', async () => {
    expect(userDataKeptLines()).toEqual([...TODAY_USER_KEPT, 'Your saved searches']);
    expect((await services().user.summary(USER)).kept).toEqual([...TODAY_USER_KEPT, 'Your saved searches']);
  });

  it('puts a factory-reset-only kept model on the factory reset page, not the Danger Zone', async () => {
    expect(factoryResetKeptLines()).toEqual([...TODAY_FACTORY_KEPT, 'Your saved searches', 'Your brand kit']);
    expect(userDataKeptLines()).not.toContain('Your brand kit');
    expect((await services().factory.summary(USER)).kept).toContain('Your brand kit');
  });

  it('adds one deleted line per step with a summary, and none for a step without one', async () => {
    expect(factoryResetDeletedLines()).toEqual([...TODAY_FACTORY_DELETED, 'Every saved report and its schedule']);
    expect((await services().factory.summary(USER)).deleted).toEqual([...TODAY_FACTORY_DELETED, 'Every saved report and its schedule']);
  });
});
