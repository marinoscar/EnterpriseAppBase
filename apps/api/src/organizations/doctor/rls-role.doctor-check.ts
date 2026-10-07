import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  DoctorCheck,
  DoctorCheckOutcome,
  DoctorCheckRegistry,
} from '@marinoscar/platform-api/doctor';
import { PrismaSystemService } from '../../prisma/prisma-system.service';

/** What the check reads from the catalogue. */
export interface RlsRoleFacts {
  /** `current_user`: the role the API connects as. */
  role: string;
  /** `pg_roles.rolsuper`. */
  superuser: boolean;
  /** `pg_roles.rolbypassrls`. */
  bypassRls: boolean;
  /** Tables of the `public` schema that FORCE row-level security. */
  forcedTables: number;
}

const RUNBOOK = 'docs/SECURITY-ARCHITECTURE.md (Tenant isolation (RLS), "The application role")';

/**
 * Pure: is tenant isolation actually enforced for the role the API runs as?
 *
 * A superuser or `BYPASSRLS` role ignores every policy, FORCE included: the
 * policies exist, the checks that count them pass, and every organization can
 * read every other's rows. This is the one condition that makes the whole
 * row-level-security story inert, so it fails loudly.
 *
 * - `fail`: the role is a superuser or has `BYPASSRLS` while a table forces
 *   row-level security.
 * - `pass`: the role is an ordinary one (isolation is enforced), or no table
 *   forces row-level security yet (nothing to bypass).
 */
export function decideRlsRole(facts: RlsRoleFacts): DoctorCheckOutcome {
  const data = {
    role: facts.role,
    superuser: facts.superuser,
    bypassRls: facts.bypassRls,
    forcedTables: facts.forcedTables,
  };

  if ((facts.superuser || facts.bypassRls) && facts.forcedTables > 0) {
    const why = facts.superuser ? 'a superuser' : 'a BYPASSRLS role';
    return {
      status: 'fail',
      detail:
        `The API connects as "${facts.role}", ${why}, so the row-level security on ${facts.forcedTables} ` +
        'table(s) is INERT: every organization can read every other organization\'s rows',
      remedy:
        'Run the API as an ordinary role (NOSUPERUSER NOBYPASSRLS) that owns the tables: set POSTGRES_USER ' +
        'to that role, re-run the migrations as it, and restart. A superuser may remain for the cluster ' +
        `administration connection only. See ${RUNBOOK}.`,
      data,
    };
  }

  return {
    status: 'pass',
    detail:
      facts.forcedTables === 0
        ? `"${facts.role}" is the API role; no table forces row-level security yet`
        : `"${facts.role}" is an ordinary role: row-level security on ${facts.forcedTables} table(s) is enforced`,
    data,
  };
}

/**
 * `auth` / `tenancy.rls-role` — the API's database role is subject to
 * row-level security. Read-only: two catalogue reads over the system
 * connection (reason `doctor`).
 */
@Injectable()
export class RlsRoleDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'tenancy.rls-role';
  readonly category = 'auth';
  readonly label = 'Tenant isolation role';
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly system: PrismaSystemService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const db = this.system.asSystem('doctor');
    const [roles, forced] = await Promise.all([
      db.$queryRaw<Array<{ role: string; superuser: boolean; bypassrls: boolean }>>`
        SELECT rolname AS role, rolsuper AS superuser, rolbypassrls AS bypassrls
        FROM pg_roles WHERE rolname = current_user`,
      db.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pg_class
        WHERE relforcerowsecurity AND relnamespace = 'public'::regnamespace`,
    ]);

    const role = roles[0];
    return decideRlsRole({
      role: role?.role ?? 'unknown',
      superuser: role?.superuser === true,
      bypassRls: role?.bypassrls === true,
      forcedTables: Number(forced[0]?.count ?? 0),
    });
  }
}
