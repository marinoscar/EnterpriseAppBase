// Runs the repository's platform lint config over fixture files through the
// ESLint Node API (`new ESLint(...)` + `lintText`). Used by
// test/boundaries.spec.ts as a child process: Jest's CommonJS module system
// cannot load the ESM config (eslint.config.mjs) in-process.
//
// stdin:  { "eslint": "<abs path of eslint's api>", "config": "<abs path of eslint.config.mjs>",
//           "rootPath": "<fixture repo root>", "graph": { ... }, "cases": [{ "filePath", "code" }] }
// stdout: [{ "filePath", "messages": [{ "ruleId", "message" }] }]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const input = JSON.parse(readFileSync(0, 'utf8'));
const { ESLint } = await import(pathToFileURL(input.eslint).href);
const { createPlatformLintConfig } = await import(pathToFileURL(input.config).href);

const eslint = new ESLint({
  cwd: input.rootPath,
  overrideConfigFile: true,
  overrideConfig: createPlatformLintConfig({ graph: input.graph, rootPath: input.rootPath }),
});

const out = [];
for (const { filePath, code } of input.cases) {
  const [result] = await eslint.lintText(code, { filePath: join(input.rootPath, filePath) });
  out.push({
    filePath,
    messages: (result?.messages ?? []).map(({ ruleId, message }) => ({ ruleId, message })),
  });
}
process.stdout.write(JSON.stringify(out));
