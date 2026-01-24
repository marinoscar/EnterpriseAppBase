import { Module } from '@nestjs/common';
import { StorageProvidersModule } from './providers/storage-providers.module';
import { CommonModule } from '../common/common.module';
import { ObjectsController } from './objects/objects.controller';
import { ObjectsService } from './objects/objects.service';

@Module({
  imports: [
    StorageProvidersModule,
    CommonModule,
  ],
  controllers: [ObjectsController],
  providers: [ObjectsService],
  exports: [ObjectsService],
})
export class StorageModule {}
