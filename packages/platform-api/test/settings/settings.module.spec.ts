// SettingsModule.forRoot (issue #733): options are validated, the composed
// controllers are built from the registries as they are when it runs, and
// the org route is not mounted when the org layer is off.
import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import {
  OrgSettingsController,
  SettingsModule,
  resolveSettingsModuleOptions,
  systemSettingsNamespaceRegistry,
} from '../../src/settings/index';
import { PLAIN_NS } from './support';

describe('SettingsModule.forRoot', () => {
  it('validates its options', () => {
    expect(resolveSettingsModuleOptions()).toMatchObject({ systemRowKey: 'global', orgLayer: 'auto' });
    expect(() => resolveSettingsModuleOptions({ systemRowKey: 'Global Row' })).toThrow(/systemRowKey/);
    expect(() => resolveSettingsModuleOptions({ orgLayer: 'sometimes' as never })).toThrow(/orgLayer/);
  });

  it('mounts the user, system and org controllers, in that order, globally', () => {
    const mod = SettingsModule.forRoot();
    expect(mod.global).toBe(true);
    expect(mod.controllers?.map((c) => c.name)).toEqual(['UserSettingsController', 'SystemSettingsController', 'OrgSettingsController']);
    expect(mod.controllers?.[2]).toBe(OrgSettingsController);
  });

  it('leaves the org route out when the org layer is off', () => {
    expect(SettingsModule.forRoot({ orgLayer: false }).controllers?.map((c) => c.name)).toEqual([
      'UserSettingsController',
      'SystemSettingsController',
    ]);
  });

  it('composes the PATCH body from the namespaces registered before it runs', () => {
    withTemporaryEntries(systemSettingsNamespaceRegistry, [PLAIN_NS], () => {
      const controller = SettingsModule.forRoot().controllers![1]!;
      const types = Reflect.getMetadata('design:paramtypes', controller.prototype, 'patchSettings') as Array<{ schema?: z.ZodObject<z.ZodRawShape> }>;
      expect(Object.keys(types[0]!.schema!.shape)).toEqual(['plainSample']);
    });
  });
});
