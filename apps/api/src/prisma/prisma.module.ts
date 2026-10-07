import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaSystemService } from './prisma-system.service';
import { ScopedPrismaService } from './ownership/scoped-prisma.service';

@Global()
@Module({
  providers: [PrismaService, PrismaSystemService, ScopedPrismaService],
  exports: [PrismaService, PrismaSystemService, ScopedPrismaService],
})
export class PrismaModule {}
