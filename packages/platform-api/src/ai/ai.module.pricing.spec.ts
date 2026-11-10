// AiModule.forRoot({ pricing }) (PP-14.17, #935): the price list is bound where
// the usage service can see it, or boot fails naming the option.

import type { DynamicModule } from '@nestjs/common';

import { AiModule } from './ai.module';
import { AI_PRICING } from './ports';

function optionsModuleOf(dynamic: DynamicModule): DynamicModule {
  const found = (dynamic.imports ?? []).find(
    (entry): entry is DynamicModule =>
      typeof entry === 'object' &&
      entry !== null &&
      'providers' in entry &&
      (entry.providers ?? []).some((provider) => typeof provider === 'object' && 'provide' in provider && String(provider.provide).includes('MODULE_OPTIONS')),
  );

  if (!found) throw new Error('the options module is not imported');

  return found;
}

describe('AiModule.forRoot({ pricing })', () => {
  it('provides nothing under AI_PRICING without the option (no cost anywhere)', () => {
    const options = optionsModuleOf(AiModule.forRoot());

    expect(options.exports).not.toContain(AI_PRICING);
  });

  it.each<[string, Record<string, unknown>]>([
    ['useClass', { useClass: class Pricing { costFor() { return null; } } }],
    ['useExisting', { useExisting: Symbol.for('app/PRICING') }],
    ['useFactory', { useFactory: () => ({ costFor: () => null }) }],
  ])('binds a %s port globally, where the usage service injects it', (_name, binding) => {
    const options = optionsModuleOf(AiModule.forRoot({ pricing: binding as never }));

    expect(options.exports).toContain(AI_PRICING);
    expect(options.providers).toEqual(expect.arrayContaining([expect.objectContaining({ provide: AI_PRICING, ...binding })]));
  });

  it("imports the host's modules into the options module, so a useExisting binding resolves from them", () => {
    class HostModule {}
    const options = optionsModuleOf(AiModule.forRoot({ imports: [HostModule], pricing: { useExisting: Symbol.for('app/PRICING') } }));

    expect(options.imports).toContain(HostModule);
  });

  it.each([
    ['none of the three shapes', {}],
    ['two shapes at once', { useClass: class A {}, useFactory: () => ({}) }],
  ])('refuses a binding with %s, naming the option', (_name, binding) => {
    expect(() => AiModule.forRoot({ pricing: binding as never })).toThrow(/pricing/);
  });
});
