/**
 * The org-aware principal and scope contract (types; see
 * docs/adr/0001-org-aware-principal-and-scope.md) and the principal kind and
 * credential kind registries behind its open vocabularies (PP-14.14).
 */
export {
  KIND_ID_PATTERN,
  UnknownCredentialKindError,
  credentialKindRegistry,
  isCredentialKind,
  principalKindRegistry,
  registerCredentialKind,
  registerPrincipalKind,
  requireCredentialKind,
} from './credential-kinds';
export type { CredentialKindDef, PrincipalKindDef } from './credential-kinds';
export type {
  TenancyMode,
  BuiltinCredentialKind,
  BuiltinPrincipalKind,
  OrgMembership,
  GroupMembership,
  UserPrincipal,
  NodePrincipal,
  Principal,
  Scope,
  SystemActor,
} from './principal.types';
