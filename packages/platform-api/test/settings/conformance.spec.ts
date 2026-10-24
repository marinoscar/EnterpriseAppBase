// The settings conformance suite (issue #733) finds what it promises to.
import { withTemporaryEntries } from '../../src/core/index';
import { systemSettingsNamespaceRegistry } from '../../src/settings/index';
import { checkNamespaceDeclarations, checkNoSecretFields, settingsConformanceSuite } from '../../src/settings/testing/index';
import { conformanceSuites } from '../../src/testing/index';
import { OVERRIDE_NS, PLAIN_NS, TIGHTEN_NS } from './support';

describe('settings conformance suite', () => {
  it('registers itself with the harness on import', () => {
    expect(conformanceSuites.has('settings')).toBe(true);
    expect(settingsConformanceSuite.id).toBe('settings');
  });

  it('flags an org layer whose permission is unregistered or of system scope', () =>
    withTemporaryEntries(systemSettingsNamespaceRegistry, [PLAIN_NS, OVERRIDE_NS, TIGHTEN_NS as never], () => {
      const findings = checkNamespaceDeclarations({
        permissions: [
          { id: 'org_settings:read', scope: 'org' },
          { id: 'org_settings:write', scope: 'system' },
        ],
      });
      expect(findings.map((f) => `${f.file}: ${f.message}`)).toEqual([
        'system:brandingSample: org.writePermission org_settings:write is a system permission; an org layer is gated by an org permission',
        'system:exportsSample: org.writePermission exports_admin:write is not a registered permission',
      ]);
      expect(checkNoSecretFields()).toEqual([]);
    }));

  it('reports a stale catalog and too few namespaces', () =>
    withTemporaryEntries(systemSettingsNamespaceRegistry, [PLAIN_NS], () => {
      const report = settingsConformanceSuite.check(
        { sourceRoots: [] },
        { permissions: [], catalog: { contents: '{}', staleMessage: 'run the generator' }, minSystemNamespaces: 2 },
      );
      expect(report.findings.map((f) => f.file)).toEqual(['registry', 'catalog']);
      expect(report.scanned).toEqual({ systemNamespaces: 1, userNamespaces: 0, orgLayers: 0 });
    }));
});
