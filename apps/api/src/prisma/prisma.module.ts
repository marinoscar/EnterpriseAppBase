import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ScopedPrismaService } from './ownership/scoped-prisma.service';

@Global()
@Module({
  providers: [PrismaService, ScopedPrismaService],
  exports: [PrismaService, ScopedPrismaService],
})
export class PrismaModule {}
