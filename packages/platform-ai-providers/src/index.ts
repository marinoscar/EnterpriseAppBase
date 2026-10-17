// `@marinoscar/platform-ai-providers`: the provider-agnostic core (types, the
// adapter and port interfaces, `AiError`, capability helpers, structured
// output, tools, hosted tools, conversation helpers, media and file-input
// types, the logger and tracer ports). Side-effect free and SDK-free: each
// provider's adapter is its own subpath (`./openai`, `./anthropic`,
// `./gemini`), so an SDK loads only when its subpath is imported.
export * from './core/index';
