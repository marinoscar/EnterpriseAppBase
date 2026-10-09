import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { PLATFORM_PRISMA, type PrismaClientLike } from '../../core/index';

/**
 * The Terminus indicator behind `GET /api/health` and `/ready`: a timed
 * `SELECT 1` through the `PLATFORM_PRISMA` host port. Throws
 * `HealthCheckError` on failure (right for Terminus).
 *
 * @stability experimental
 */
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: PrismaClientLike) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Execute simple query to verify connection
      await this.prisma.$queryRaw`SELECT 1`;

      const responseTime = Date.now() - startTime;

      return this.getStatus(key, true, {
        responseTime: `${responseTime}ms`,
      });
    } catch (error) {
      const responseTime = Date.now() - startTime;

      this.logger.error('Database health check failed', error);

      throw new HealthCheckError(
        'Database check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'Unknown error',
          responseTime: `${responseTime}ms`,
        }),
      );
    }
  }
}
