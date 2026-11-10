// `@marinoscar/platform-cli/core`: the CLI's registries and the pure helpers
// behind env-key metadata (PP-4.5, #706). The seed of #715.

export {
  applyRegisteredCommands,
  freezeCommandRegistry,
  listRegisteredCommands,
  registerCliCommand,
  resetCommandRegistryForTests,
} from './command-registry.js';
export type { CliCommandRegistration } from './command-registry.js';

export {
  freezeEnvSpecRegistry,
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

export { createCliRegistry } from './cli-registry.js';
export type { CliRegistry, CliRegistryOptions } from './cli-registry.js';

export {
  freezeEnvGroupRegistry,
  getEnvGroup,
  listEnvGroups,
  registerEnvGroup,
  resetEnvGroupRegistryForTests,
} from './env-group-registry.js';
export type { EnvGroupRegistration } from './env-group-registry.js';

export {
  freezeEnvGeneratorRegistry,
  generateWithKind,
  listEnvGenerators,
  registerEnvGenerator,
  resetEnvGeneratorRegistryForTests,
} from './env-generator-registry.js';
export type { EnvGeneratorRegistration } from './env-generator-registry.js';

export {
  annotateEnvKey,
  freezeEnvAnnotationRegistry,
  getEnvAnnotation,
  listEnvAnnotations,
  resetEnvAnnotationRegistryForTests,
} from './env-annotation-registry.js';
export type { EnvKeyAnnotation } from './env-annotation-registry.js';
