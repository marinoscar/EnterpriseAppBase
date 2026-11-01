// The user-data slice's host ports (issue #743), bound to this app.
//
// `USER_DATA_DB` is the bypass client: a user's rows live in every
// organization they belong to, and offboarding and the factory reset cross
// organizations by definition, so row-level security must not hide a row from
// the purge. On the reviewed allowlist of
// test/tenancy/system-injection-boundary.spec.ts (reasons `purge` and
// `admin-aggregate`).

import { Injectable } from '@nestjs/common';
import type { UserDataDbPort, UserDataSystemReason } from '@marinoscar/platform-api/user-data';

import { PrismaSystemService } from '../../prisma/prisma-system.service';

/** `USER_DATA_DB`: the bypass client, by reason. */
@Injectable()
export class UserDataDbAdapter implements UserDataDbPort {
  constructor(private readonly prismaSystem: PrismaSystemService) {}

  runAsSystem<R>(reason: UserDataSystemReason, fn: (tx: any) => Promise<R>, options?: { timeout?: number }): Promise<R> {
    return this.prismaSystem.runAsSystem(reason, fn, options ?? {});
  }

  system(reason: UserDataSystemReason): any {
    return this.prismaSystem.asSystem(reason);
  }
}
