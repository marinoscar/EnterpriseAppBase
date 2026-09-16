export { CredentialsModule } from './credentials.module';
export { CredentialsService } from './credentials.service';
export type {
  CredentialInfo,
  CredentialMeta,
} from './interfaces/credential-info.interface';

// Per-user encrypted credential store (issue #387). A sibling of the system
// store above, not a replacement for it — see `user-credentials.service.ts`.
export { UserCredentialsModule } from './user-credentials.module';
export { UserCredentialsService } from './user-credentials.service';
export { UserCredentialResolver } from './user-credential-resolver.service';
export type {
  ResolvedCredential,
  UserCredentialSource,
} from './user-credential-resolver.service';
export type {
  UserCredentialInfo,
  UserCredentialMeta,
} from './interfaces/user-credential-info.interface';
export {
  USER_CREDENTIAL_PURPOSES,
  findUserCredentialPurpose,
} from './user-credential-purposes';
export type { UserCredentialPurposeDef } from './user-credential-purposes';

// NOT exported: `credential-internals.ts`. It is shared between the two stores
// in this directory and nothing outside them should be deriving hints or
// deciding what "blank" means — a consumer that needs either is a consumer
// re-implementing half a store.
