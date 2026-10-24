import { aiFeatureViewSchema } from '@marinoscar/platform-contract/ai';
import { createZodDto } from 'nestjs-zod';

/** `GET /api/ai/features` item (#739). */
export class AiFeatureViewDto extends createZodDto(aiFeatureViewSchema) {}
