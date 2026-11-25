// Runs in its own process: requires the package root and reports what it left behind.
// zod is a peer the package may require; its own singletons (`__zod_*`) are not the package's side effects.
require('zod');
const before = new Set(Object.keys(globalThis));
const resourcesBefore = process.getActiveResourcesInfo().length;
const started = process.hrtime.bigint();
const root = require('@marinoscar/platform-ai-providers');
const loadMs = Number(process.hrtime.bigint() - started) / 1e6;

const forbidden = /[\\/]node_modules[\\/](openai|@anthropic-ai|@google|@nestjs|@opentelemetry|reflect-metadata|rxjs|@prisma)[\\/]/;
// fs.writeSync, not process.stdout: touching process.stdout opens a pipe handle of its own.
require('node:fs').writeSync(
  1,
  `${JSON.stringify({
    exports: Object.keys(root).length,
    loadMs,
    forbiddenModules: Object.keys(require.cache).filter((k) => forbidden.test(k)),
    addedGlobals: Object.keys(globalThis).filter((k) => !before.has(k)),
    extraResources: process.getActiveResourcesInfo().slice(resourcesBefore),
  })}\n`,
);
// No process.exit(): a lingering handle (timer, socket, listener) would keep this process alive.
