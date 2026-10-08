// Binds the user-data slice's host ports (issue #743), passed to
// `UserDataModule.forRoot({ imports })` by ./user-data.config.ts.

import { Module } from '@nestjs/common';
import { OrganizationsModule } from '@marinoscar/platform-api/identity';
import { USER_DATA_DB, USER_DATA_ENVIRONMENT } from '@marinoscar/platform-api/user-data';

import { UserDataDbAdapter, UserDataEnvironmentAdapter } from './user-data-db.adapter';

@Module({
  imports: [OrganizationsModule],
  providers: [
    UserDataDbAdapter,
    UserDataEnvironmentAdapter,
    { provide: USER_DATA_DB, useExisting: UserDataDbAdapter },
    { provide: USER_DATA_ENVIRONMENT, useExisting: UserDataEnvironmentAdapter },
  ],
  exports: [USER_DATA_DB, USER_DATA_ENVIRONMENT],
})
export class UserDataHostModule {}
