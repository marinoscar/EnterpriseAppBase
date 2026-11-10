import type { ConfigService } from '@nestjs/config';

import { RegistryError } from '../../../src/core/index';
import { withTemporaryEntries } from '../../../src/core/registry/testing';
import {
  BUILTIN_DEPLOYMENT_MODES,
  DEPLOYMENT_MODES,
  DeploymentModeService,
  capabilitiesFor,
  deploymentCapabilityRegistry,
  deploymentModeRegistry,
  describeDeploymentMode,
  parseDeploymentMode,
  registerDeploymentCapability,
  registerDeploymentMode,
} from '../../../src/host/index';

const serviceFor = (raw: string) => new DeploymentModeService({ get: () => raw } as unknown as ConfigService);

describe('deployment modes and capabilities are open (PP-14.13)', () => {
  it('registers the built-ins through the public functions, in the documented order', () => {
    expect(deploymentModeRegistry.name).toBe('host.deployment-modes');
    expect(deploymentModeRegistry.ids()).toEqual(['self-hosted', 'saas']);
    expect(deploymentCapabilityRegistry.ids()).toEqual(['inAppRestore']);
    expect(BUILTIN_DEPLOYMENT_MODES).toEqual(['self-hosted', 'saas']);
    expect(DEPLOYMENT_MODES).toBe(BUILTIN_DEPLOYMENT_MODES);
  });

  it('keeps the built-in behaviour byte for byte', () => {
    expect(capabilitiesFor('self-hosted')).toEqual({ inAppRestore: true });
    expect(capabilitiesFor('saas')).toEqual({ inAppRestore: false });
    expect(() => parseDeploymentMode('bogus')).toThrow(/Allowed values: self-hosted, saas \(unset means self-hosted\)/);
  });

  describe('registerDeploymentMode', () => {
    it('makes a mode selectable, with its own capability values', async () => {
      await withTemporaryEntries(deploymentModeRegistry, [], async () => {
        registerDeploymentMode({ id: 'byoc', capabilities: { inAppRestore: false } });
        expect(parseDeploymentMode('byoc')).toBe('byoc');
        expect(parseDeploymentMode(' byoc ')).toBe('byoc');
        expect(capabilitiesFor('byoc')).toEqual({ inAppRestore: false });
        expect(describeDeploymentMode('byoc')).toContain('DISABLED');
        const service = serviceFor('byoc');
        expect(service.mode).toBe('byoc');
        expect(service.inAppRestoreEnabled).toBe(false);
        expect(() => service.assertInAppRestoreEnabled()).toThrow();
      });
      expect(() => parseDeploymentMode('byoc')).toThrow(/not a valid deployment mode/);
    });

    it('lists the registered modes in the startup error, and stays case-sensitive', async () => {
      await withTemporaryEntries(deploymentModeRegistry, [], () => {
        registerDeploymentMode({ id: 'byoc', capabilities: {} });
        expect(() => parseDeploymentMode('BYOC')).toThrow(/Allowed values: self-hosted, saas, byoc/);
      });
    });

    it.each(['A', 'x', 'Self-Hosted', 'byoc_1', '1byoc', 'x'.repeat(33)])('refuses the id %p', async (id) => {
      await withTemporaryEntries(deploymentModeRegistry, [], () => {
        expect(() => registerDeploymentMode({ id, capabilities: {} })).toThrow(RegistryError);
      });
    });

    it('refuses a duplicate and a non-boolean capability value', async () => {
      await withTemporaryEntries(deploymentModeRegistry, [], () => {
        expect(() => registerDeploymentMode({ id: 'saas', capabilities: {} })).toThrow(RegistryError);
        expect(() => registerDeploymentMode({ id: 'odd', capabilities: { inAppRestore: 'no' as never } })).toThrow(/boolean/);
      });
    });

    it('refuses to resolve a mode that sets a capability nobody registered', async () => {
      await withTemporaryEntries(deploymentModeRegistry, [], () => {
        registerDeploymentMode({ id: 'typo', capabilities: { inAppRestor: false } });
        expect(() => capabilitiesFor('typo')).toThrow(/"inAppRestor".*registerDeploymentCapability/);
      });
    });

    it('refuses to resolve a mode nobody registered', () => {
      expect(() => capabilitiesFor('nope')).toThrow(/Unknown deployment mode "nope".*registerDeploymentMode/);
    });
  });

  describe('registerDeploymentCapability', () => {
    it('resolves mode entry, then byMode, then default', async () => {
      await withTemporaryEntries(deploymentCapabilityRegistry, [], () =>
        withTemporaryEntries(deploymentModeRegistry, [], () => {
          registerDeploymentCapability({ id: 'bulkExport', default: true, byMode: { saas: false } });
          registerDeploymentCapability({ id: 'sso', default: false });
          registerDeploymentMode({ id: 'byoc', capabilities: { sso: true, bulkExport: true } });

          expect(capabilitiesFor('self-hosted')).toEqual({ inAppRestore: true, bulkExport: true, sso: false });
          expect(capabilitiesFor('saas')).toEqual({ inAppRestore: false, bulkExport: false, sso: false });
          // the mode's own entry beats the capability's byMode and default
          expect(capabilitiesFor('byoc')).toEqual({ inAppRestore: true, bulkExport: true, sso: true });

          const service = serviceFor('saas');
          expect(service.can('bulkExport')).toBe(false);
          expect(service.can('inAppRestore')).toBe(false);
          expect(() => service.can('unknown')).toThrow(/Unknown deployment capability/);
          expect(() => service.can('toString')).toThrow(/Unknown deployment capability/);
        }),
      );
    });

    it('refuses a bad id, a duplicate of the built-in and a non-boolean default', async () => {
      await withTemporaryEntries(deploymentCapabilityRegistry, [], () => {
        expect(() => registerDeploymentCapability({ id: 'in-app', default: true })).toThrow(RegistryError);
        expect(() => registerDeploymentCapability({ id: 'InApp', default: true })).toThrow(RegistryError);
        expect(() => registerDeploymentCapability({ id: 'inAppRestore', default: true })).toThrow(RegistryError);
        expect(() => registerDeploymentCapability({ id: 'flag', default: 'yes' as never })).toThrow(/default/);
        expect(() => registerDeploymentCapability({ id: 'flag', default: true, byMode: { saas: 1 as never } })).toThrow(/byMode/);
      });
    });
  });
});
