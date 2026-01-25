import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find the repository root by looking for package.json with workspaces
 */
function findRepoRoot(): string {
  let current = __dirname;

  // Walk up the directory tree looking for the root package.json
  while (current !== dirname(current)) {
    const packageJsonPath = join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        // Root package.json has workspaces
        if (pkg.workspaces) {
          return current;
        }
      } catch {
        // Continue searching
      }
    }
    current = dirname(current);
  }

  // Fallback: assume we're in tools/app/dist/utils
  return resolve(__dirname, '..', '..', '..', '..');
}

export const REPO_ROOT = findRepoRoot();

export const paths = {
  // Repository root
  root: REPO_ROOT,

  // Compose files
  composeDir: join(REPO_ROOT, 'infra', 'compose'),
  baseCompose: join(REPO_ROOT, 'infra', 'compose', 'base.compose.yml'),
  devCompose: join(REPO_ROOT, 'infra', 'compose', 'dev.compose.yml'),
  prodCompose: join(REPO_ROOT, 'infra', 'compose', 'prod.compose.yml'),
  otelCompose: join(REPO_ROOT, 'infra', 'compose', 'otel.compose.yml'),
  testCompose: join(REPO_ROOT, 'infra', 'compose', 'test.compose.yml'),

  // App directories
  apiDir: join(REPO_ROOT, 'apps', 'api'),
  webDir: join(REPO_ROOT, 'apps', 'web'),

  // Scripts
  scriptsDir: join(REPO_ROOT, 'scripts'),
};

/**
 * Verify that required paths exist
 */
export function verifyPaths(): { valid: boolean; missing: string[] } {
  const required = [
    paths.baseCompose,
    paths.devCompose,
    paths.apiDir,
    paths.webDir,
  ];

  const missing = required.filter((p) => !existsSync(p));

  return {
    valid: missing.length === 0,
    missing,
  };
}
