import { resolveStorageModuleOptions } from '../../src/storage/storage.options';

// PP-14.1: the `provider` option of `StorageModule.forRoot`.
describe('resolveStorageModuleOptions: provider', () => {
  class AppProvider {}

  it('leaves `provider` absent by default, so the resolving provider stays in force', () => {
    expect('provider' in resolveStorageModuleOptions({})).toBe(false);
  });

  it.each([
    ['useClass', { useClass: AppProvider as never }],
    ['useExisting', { useExisting: 'APP_STORAGE' }],
    ['useFactory', { useFactory: () => ({}) as never }],
  ])('accepts a %s binding and carries it through unchanged', (_name, binding) => {
    expect(resolveStorageModuleOptions({ provider: binding }).provider).toBe(binding);
  });

  it('rejects a binding with none or several of useExisting, useClass and useFactory', () => {
    expect(() => resolveStorageModuleOptions({ provider: {} as never })).toThrow(/exactly one of useExisting, useClass or useFactory/);
    expect(() =>
      resolveStorageModuleOptions({ provider: { useClass: AppProvider, useExisting: 'X' } as never }),
    ).toThrow(/exactly one/);
  });
});
