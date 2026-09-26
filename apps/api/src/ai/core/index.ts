// Public surface of the provider-agnostic AI core (issue #424, epic #419).
// Feature code imports from here, never from a provider's folder.
export * from './capabilities';
export * from './ai-error';
export * from './provider-adapter.interface';
export * from './types/responses.types';
export * from './types/media.types';
export * from './provider-registry';
