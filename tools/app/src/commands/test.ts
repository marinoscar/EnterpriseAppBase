import { Command } from 'commander';
import { exec } from '../utils/exec.js';
import { paths } from '../utils/paths.js';
import * as output from '../utils/output.js';

/**
 * Run API tests
 */
async function runApiTests(mode?: string): Promise<number> {
  let script = 'test';

  switch (mode?.toLowerCase()) {
    case 'watch':
      output.info('Running API tests in watch mode...');
      script = 'test:watch';
      break;
    case 'coverage':
      output.info('Running API tests with coverage...');
      script = 'test:cov';
      break;
    case 'e2e':
      output.info('Running API E2E tests...');
      script = 'test:e2e';
      break;
    case 'unit':
      output.info('Running API unit tests...');
      script = 'test:unit';
      break;
    default:
      output.info('Running API tests...');
  }

  return exec('npm', ['run', script], { cwd: paths.apiDir });
}

/**
 * Run Web tests
 */
async function runWebTests(mode?: string): Promise<number> {
  let script = 'test:run';

  switch (mode?.toLowerCase()) {
    case 'ui':
      output.info('Opening Vitest UI for Web tests...');
      output.info('Test UI will be available at: http://localhost:51204/__vitest__/');
      script = 'test:ui';
      break;
    case 'watch':
      output.info('Running Web tests in watch mode...');
      script = 'test:watch';
      break;
    case 'coverage':
      output.info('Running Web tests with coverage...');
      script = 'test:coverage';
      break;
    default:
      output.info('Running Web tests...');
  }

  return exec('npm', ['run', script], { cwd: paths.webDir });
}

/**
 * Run E2E tests
 */
async function runE2ETests(): Promise<number> {
  output.info('Running E2E tests...');

  // Start test database
  output.info('Starting test database...');
  const startCode = await exec(
    'docker',
    ['compose', '-f', paths.testCompose, 'up', '-d'],
    { cwd: paths.composeDir }
  );

  if (startCode !== 0) {
    output.error('Failed to start test database');
    return startCode;
  }

  // Wait for database to be ready
  output.dim('Waiting for database to be ready...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Set environment variables for test
  const env = {
    ...process.env,
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5433',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
    POSTGRES_DB: 'enterprise_app_test',
    POSTGRES_SSL: 'false',
  };

  // Run E2E tests
  const testCode = await exec('npm', ['run', 'test:e2e'], {
    cwd: paths.apiDir,
    env,
  });

  // Stop test database
  output.info('Stopping test database...');
  await exec('docker', ['compose', '-f', paths.testCompose, 'down'], {
    cwd: paths.composeDir,
  });

  return testCode;
}

/**
 * Run type checks
 */
async function runTypeCheck(): Promise<boolean> {
  output.info('Running type checks...');
  output.blank();

  // Type check API
  output.info('Type checking API...');
  const apiCode = await exec('npx', ['tsc', '--noEmit'], { cwd: paths.apiDir });

  if (apiCode !== 0) {
    output.error('API type check failed!');
    return false;
  }
  output.success('API type check passed!');
  output.blank();

  // Type check Web
  output.info('Type checking Web...');
  const webCode = await exec('npx', ['tsc', '--noEmit'], { cwd: paths.webDir });

  if (webCode !== 0) {
    output.error('Web type check failed!');
    return false;
  }
  output.success('Web type check passed!');

  output.blank();
  output.success('All type checks passed!');
  return true;
}

/**
 * Run all tests (default)
 */
async function runAllTests(includeE2E: boolean = false): Promise<void> {
  if (includeE2E) {
    output.info('Running ALL tests (type checks + unit + integration + E2E)...');
  } else {
    output.info('Running all tests...');
  }
  output.blank();

  // Run type checks first
  const typeCheckPassed = await runTypeCheck();
  if (!typeCheckPassed) {
    output.error('Type checks failed. Stopping.');
    process.exit(1);
  }

  output.blank();

  // Run API tests
  const apiCode = await runApiTests();
  if (apiCode !== 0) {
    output.error('API tests failed. Stopping.');
    process.exit(1);
  }

  output.blank();

  // Run Web tests
  const webCode = await runWebTests();
  if (webCode !== 0) {
    output.error('Web tests failed. Stopping.');
    process.exit(1);
  }

  if (includeE2E) {
    output.blank();

    // Run E2E tests
    const e2eCode = await runE2ETests();
    if (e2eCode !== 0) {
      output.error('E2E tests failed.');
      process.exit(1);
    }
  }

  output.blank();
  output.success('All tests completed!');
}

/**
 * Run coverage tests
 */
async function runCoverageTests(): Promise<void> {
  output.info('Running all tests with coverage...');
  output.blank();

  await runApiTests('coverage');
  output.blank();
  await runWebTests('coverage');
}

/**
 * Register test commands with Commander
 */
export function registerTestCommands(program: Command): void {
  const testCmd = program
    .command('test')
    .description('Run tests. Options: api, web, all, coverage, e2e, typecheck')
    .argument('[target]', 'Test target (api, web, all, coverage, e2e, typecheck)')
    .argument('[mode]', 'Test mode (watch, coverage, ui, unit, e2e)')
    .action(async (target?: string, mode?: string) => {
      switch (target?.toLowerCase()) {
        case 'api':
          const apiCode = await runApiTests(mode);
          process.exit(apiCode);
          break;

        case 'web':
          const webCode = await runWebTests(mode);
          process.exit(webCode);
          break;

        case 'e2e':
          const e2eCode = await runE2ETests();
          process.exit(e2eCode);
          break;

        case 'coverage':
          await runCoverageTests();
          break;

        case 'typecheck':
          const passed = await runTypeCheck();
          process.exit(passed ? 0 : 1);
          break;

        case 'all':
          await runAllTests(true);
          break;

        default:
          await runAllTests(false);
          break;
      }
    });

  // Add help text
  testCmd.addHelpText(
    'after',
    `
Examples:
  $ app test                 # Run type checks + unit tests (API + Web)
  $ app test all             # Run ALL tests (type checks + unit + E2E)
  $ app test typecheck       # Run type checks only
  $ app test api             # Run API tests (Jest)
  $ app test api watch       # Run API tests in watch mode
  $ app test api coverage    # Run API tests with coverage
  $ app test web             # Run Web tests (Vitest)
  $ app test web ui          # Open Vitest UI for Web tests
  $ app test web coverage    # Run Web tests with coverage
  $ app test e2e             # Run E2E tests (requires database)
`
  );
}

// Export for interactive mode
export {
  runApiTests,
  runWebTests,
  runE2ETests,
  runTypeCheck,
  runAllTests,
  runCoverageTests,
};
