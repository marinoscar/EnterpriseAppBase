// The pluggable-kind primitive (PP-14.5, issue #923). Recipe: ../README.md,
// "Pluggable kinds". Framework-free like the registry barrel.

export { definePluggableKind } from './pluggable-kind';
export type {
  DefinePluggableKindOptions,
  PluggableBuildInput,
  PluggableImplementation,
  PluggableKind,
  PluggableSecretPresence,
  PluggableSecretSpec,
} from './pluggable-kind';
export { PluggableSettingsError, PluggableUnknownError } from './pluggable-errors';
export { describeConfigField, describeConfigFields } from './describe-config-fields';
export type { DescribedConfigField } from './describe-config-fields';
