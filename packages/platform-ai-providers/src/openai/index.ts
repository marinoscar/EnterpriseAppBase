// `@marinoscar/platform-ai-providers/openai`: the OpenAI wire family. The OpenAI
// adapter, the OpenAI-compatible adapter (./compatible) and the Azure OpenAI
// adapter (./azure), their client factories, settings, mappers, engines,
// error mapping, guards and call telemetry. Loads the `openai` SDK.
export * from './openai-audio.mapper';
export * from './openai-call-telemetry';
export * from './openai-chat-completions-stream.mapper';
export * from './openai-chat-completions.engine';
export * from './openai-chat-completions.mapper';
export * from './openai-client.factory';
export * from './openai-embeddings.mapper';
export * from './openai-errors';
export * from './openai-family-guards';
export * from './openai-images.mapper';
export * from './openai-model-catalog';
export * from './openai-realtime.mapper';
export * from './openai-redirect-guard';
export * from './openai-responses.engine';
export * from './openai-responses.mapper';
export * from './openai-stream.mapper';
export * from './openai.adapter';
export * from './compatible/openai-compatible-client.factory';
export * from './compatible/openai-compatible-settings';
export * from './compatible/openai-compatible.adapter';
export * from './azure/azure-openai-client.factory';
export * from './azure/azure-openai-settings';
export * from './azure/azure-openai.adapter';
