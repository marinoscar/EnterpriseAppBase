import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';

import { RlsRoleDoctorCheck, decideRlsRole } from './rls-role.doctor-check';

// =============================================================================
// The Doctor check that row-level security is actually enforced (issue #725)
// =============================================================================

describe('decideRlsRole', () => {
  const ordinary = { role: 'app', superuser: false, bypassRls: false, forcedTables: 4 };

  it('fails when the role is a superuser while tables FORCE row-level security', () => {
    const outcome = decideRlsRole({ ...ordinary, role: 'postgres', superuser: true });

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toMatch(/"postgres", a superuser.*INERT/);
    expect(outcome.remedy).toMatch(/NOSUPERUSER NOBYPASSRLS/);
    expect(outcome.data).toEqual({ role: 'postgres', superuser: true, bypassRls: false, forcedTables: 4 });
  });

  it('fails when the role has BYPASSRLS while tables FORCE row-level security', () => {
    const outcome = decideRlsRole({ ...ordinary, bypassRls: true });

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toMatch(/a BYPASSRLS role/);
  });

  it('passes an ordinary role and says isolation is enforced', () => {
    const outcome = decideRlsRole(ordinary);

    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toMatch(/ordinary role.*4 table\(s\).*enforced/);
  });

  it('passes a superuser while no table forces row-level security (nothing to bypass)', () => {
    const outcome = decideRlsRole({ ...ordinary, superuser: true, forcedTables: 0 });

    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toMatch(/no table forces row-level security/);
  });
});

describe('RlsRoleDoctorCheck', () => {
  function build(roleRows: unknown[], forcedRows: unknown[]) {
    const registry = new DoctorCheckRegistry();
    const queryRaw = jest.fn().mockResolvedValueOnce(roleRows).mockResolvedValueOnce(forcedRows);
    const system = { asSystem: jest.fn().mockReturnValue({ $queryRaw: queryRaw }) };
    return { check: new RlsRoleDoctorCheck(registry, system as never), registry, system, queryRaw };
  }

  it('registers itself, depends on the connection check and reads the catalogue as the doctor', async () => {
    const { check, registry, system, queryRaw } = build([{ role: 'postgres', superuser: true, bypassrls: false }], [{ count: 4 }]);

    check.onModuleInit();
    expect(registry.get('db.rls_role')).toBe(check);
    expect(check.dependsOn).toEqual(['db.connection']);

    const outcome = await check.run();

    expect(system.asSystem).toHaveBeenCalledWith('doctor');
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe('fail');
  });

  it('passes for an ordinary role', async () => {
    const { check } = build([{ role: 'app', superuser: false, bypassrls: false }], [{ count: 4 }]);

    await expect(check.run()).resolves.toMatchObject({ status: 'pass' });
  });
});
