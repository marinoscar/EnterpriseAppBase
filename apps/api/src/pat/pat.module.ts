import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PatController } from './pat.controller';
import { PatService } from './pat.service';

@Module({
  imports: [PrismaModule],
  controllers: [PatController],
  providers: [PatService],
  exports: [PatService],
})
export class PatModule {}
