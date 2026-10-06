// `@marinoscar/platform-cli/core`: the CLI's registries and the pure helpers
// behind env-key metadata (PP-4.5, #706). The seed of #715.

export {
  applyRegisteredCommands,
  listRegisteredCommands,
  registerCliCommand,
  resetCommandRegistryForTests,
} from './command-registry.js';
export type { CliCommandRegistration } from './command-registry.js';

export {
  listEnvSpecFragments,
  registerEnvSpecFragment,
  resetEnvSpecRegistryForTests,
  resolveEnvMetadata,
} from './env-spec-registry.js';
export type { DeriveContext, EnvSpecFragment, EnvVarMetadata, GenerateKind } from './env-spec-registry.js';

export {
  generateBase64Key,
  generateHexKey,
  generateValue,
  isPlaceholderValue,
  needsAutoGenerate,
  validateBase64Key32,
  validateEmail,
  validatePort,
} from './env-values.js';
