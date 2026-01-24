import chalk from 'chalk';

/**
 * Output utilities for consistent CLI formatting
 */

export function info(message: string): void {
  console.log(chalk.cyan(message));
}

export function success(message: string): void {
  console.log(chalk.green(message));
}

export function warn(message: string): void {
  console.log(chalk.yellow(message));
}

export function error(message: string): void {
  console.log(chalk.red(message));
}

export function dim(message: string): void {
  console.log(chalk.dim(message));
}

export function bold(message: string): void {
  console.log(chalk.bold(message));
}

/**
 * Print a section header
 */
export function header(title: string): void {
  console.log('');
  console.log(chalk.bold.cyan(title));
  console.log(chalk.dim('='.repeat(title.length)));
}

/**
 * Print a key-value pair
 */
export function keyValue(key: string, value: string): void {
  console.log(`${chalk.dim(key + ':')} ${value}`);
}

/**
 * Print a table row
 */
export function tableRow(columns: string[], widths: number[]): void {
  const formatted = columns.map((col, i) => col.padEnd(widths[i] || 20));
  console.log(formatted.join('  '));
}

/**
 * Print table header
 */
export function tableHeader(columns: string[], widths: number[]): void {
  tableRow(columns, widths);
  console.log(chalk.dim('-'.repeat(widths.reduce((a, b) => a + b + 2, 0))));
}

/**
 * Print a blank line
 */
export function blank(): void {
  console.log('');
}

/**
 * Print service URLs after start
 */
export function printServiceUrls(includeOtel: boolean = false): void {
  blank();
  info('Application:  http://localhost:3535');
  info('API:          http://localhost:3535/api');
  info('Swagger UI:   http://localhost:3535/api/docs');
  info('API Health:   http://localhost:3535/api/health/live');
  if (includeOtel) {
    info('Uptrace:      http://localhost:14318');
  }
  blank();
}
