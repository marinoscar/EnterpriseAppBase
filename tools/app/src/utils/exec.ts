import { spawn, SpawnOptions } from 'child_process';
import * as readline from 'readline';

export interface ExecOptions extends SpawnOptions {
  silent?: boolean;
}

/**
 * Execute a command and return the exit code
 */
export function exec(
  command: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<number> {
  const { silent, ...spawnOptions } = options;

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: silent ? 'pipe' : 'inherit',
      shell: true,
      ...spawnOptions,
    });

    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', () => resolve(1));
  });
}

/**
 * Execute a command and capture output
 */
export function execCapture(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: 'pipe',
      shell: true,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

/**
 * Execute an interruptible command (Ctrl+C returns instead of exiting)
 * Useful for commands like `docker compose logs -f`
 */
export function execInterruptible(
  command: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<number> {
  const { silent, ...spawnOptions } = options;

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: silent ? 'pipe' : 'inherit',
      shell: true,
      ...spawnOptions,
    });

    // Handle Ctrl+C gracefully - kill the child process and return
    const sigintHandler = () => {
      proc.kill('SIGINT');
    };

    process.on('SIGINT', sigintHandler);

    proc.on('close', (code) => {
      process.removeListener('SIGINT', sigintHandler);
      resolve(code ?? 0);
    });

    proc.on('error', () => {
      process.removeListener('SIGINT', sigintHandler);
      resolve(1);
    });
  });
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prompt for confirmation
 */
export async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} Type 'yes' to confirm: `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}
