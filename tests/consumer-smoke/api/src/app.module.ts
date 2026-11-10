import { Module } from '@nestjs/common';
import { DoctorModule, PLATFORM_DOCTOR_CATEGORIES } from '@marinoscar/platform-api/doctor';

import { platformHost } from './platform-host';
import { SMOKE_CATEGORY, SmokeFeatureModule } from './smoke.check';

@Module({
  imports: [
    DoctorModule.forRoot({ host: platformHost, categoryOrder: [...PLATFORM_DOCTOR_CATEGORIES, SMOKE_CATEGORY] }),
    SmokeFeatureModule,
  ],
})
export class AppModule {}
