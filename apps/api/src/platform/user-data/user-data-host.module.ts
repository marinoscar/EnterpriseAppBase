// Binds the user-data slice's one host port (issues #743, #880): the bypass
// client. Passed to `UserDataModule.forRoot({ imports })` by ./user-data.config.ts.
// The deployment and tenancy modes need no binding: the slice reads them from
// the host core and the identity slice.

import { Module } from '@nestjs/common';
import { USER_DATA_DB } from '@marinoscar/platform-api/user-data';

import { UserDataDbAdapter } from './user-data-db.adapter';

@Module({
  providers: [UserDataDbAdapter, { provide: USER_DATA_DB, useExisting: UserDataDbAdapter }],
  exports: [USER_DATA_DB],
})
export class UserDataHostModule {}
