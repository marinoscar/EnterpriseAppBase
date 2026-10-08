// `@marinoscar/platform-api/credentials`: the credentials slice (issue #735,
// PP-8.8): the deployment's encrypted credential store, a user's own
// (bring-your-own-key) store and the resolver that falls back from one to the
// other. Documented in ./README.md. Explicit named exports only.

// ---- the deployment store -----------------------------------------------------------
export { CredentialsModule } from './credentials.module';
export { CredentialsService } from './credentials.service';
export type { CredentialInfo, CredentialMeta } from './interfaces/credential-info.interface';

// ---- a user's own store and the resolver --------------------------------------------
export { UserCredentialsModule } from './user-credentials.module';
export { UserCredentialsService } from './user-credentials.service';
export { USER_CREDENTIAL_PURPOSE_REGISTRY, UserCredentialResolver } from './user-credential.resolver';
export type { ResolvedCredential, ResolvedCredentialSource } from './user-credential.resolver';
export {
  DEFAULT_USER_CREDENTIAL_NAME,
  USER_CREDENTIAL_PURPOSES,
  findUserCredentialPurpose,
} from './user-credential-purposes';
export type { SystemCredentialAddress, UserCredentialPurposeDef } from './user-credential-purposes';
export type { UserCredentialInfo, UserCredentialMeta } from './interfaces/user-credential-info.interface';

// ---- shared helpers -------------------------------------------------------------------
export { deriveHint } from './credential-internals';

// ---- the structural data types --------------------------------------------------------
export type {
  CredentialRow,
  CredentialsDelegate,
  CredentialsPrisma,
  CredentialsQueryArgs,
  OrgCredentialRow,
  UserCredentialRow,
} from './data/credentials-db';

// ---- the model ownership and user-owned data declarations ---------------------------
export { CREDENTIALS_MODEL_OWNERSHIP, CREDENTIALS_USER_OWNED_MODELS } from './ownership';
