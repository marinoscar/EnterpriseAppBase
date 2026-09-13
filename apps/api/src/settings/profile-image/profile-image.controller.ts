import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import { ApiDataResponse } from '../../common/decorators/api-data-response.decorator';
import { AVATAR_MAX_BYTES } from '../../common/profile-image/profile-image';
import { ProfileImageService } from './profile-image.service';
import { ProfileImageResponseDto } from './dto/profile-image-response.dto';

const MAX_MB = AVATAR_MAX_BYTES / (1024 * 1024);

/**
 * Translate `@fastify/multipart` errors (plain FastifyErrors, which the global
 * filter would otherwise turn into a 500) into client errors.
 */
function toClientError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new PayloadTooLargeException(
      `Profile image exceeds the ${MAX_MB} MB limit`,
    );
  }
  if (typeof code === 'string' && code.startsWith('FST_')) {
    return new BadRequestException(
      'Invalid multipart body. Send multipart/form-data with a single "file" field.',
    );
  }
  return error;
}

@ApiTags('User Settings')
@Controller('user-settings/profile-image')
export class ProfileImageController {
  constructor(private readonly profileImages: ProfileImageService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.USER_SETTINGS_WRITE] })
  @ApiOperation({
    summary: 'Upload a profile picture',
    description:
      `Multipart upload with a single \`file\` field. The type is determined from the file's ` +
      `content (magic bytes) — the declared MIME type and filename are ignored — and must be ` +
      `JPEG, PNG, GIF or WebP; anything else (SVG included) is a 400. Maximum ${MAX_MB} MB ` +
      `(413 above it). On success the picture is selected (\`profile.imageSource: "upload"\`) and ` +
      `any previously uploaded picture is deleted.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiDataResponse(ProfileImageResponseDto, {
    description: 'Picture stored and selected',
  })
  @ApiResponse({ status: 400, description: 'Missing file, invalid multipart body, or unsupported image type' })
  @ApiResponse({ status: 413, description: `File exceeds ${MAX_MB} MB` })
  async upload(
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId: string,
  ) {
    if (!req.isMultipart()) {
      throw new BadRequestException(
        'Expected multipart/form-data with a single "file" field.',
      );
    }

    let buffer: Buffer;
    try {
      const part = await req.file({
        limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
        throwFileSizeLimit: true,
      });

      if (!part) {
        throw new BadRequestException('No file provided');
      }
      if (part.fieldname !== 'file') {
        throw new BadRequestException('The file must be sent in the "file" field.');
      }

      // Buffered, bounded by `fileSize`: 5 MB is small enough to hold, and the
      // magic bytes must be inspected before anything reaches storage.
      // `toBuffer` rejects with FST_REQ_FILE_TOO_LARGE on a truncated file.
      buffer = await part.toBuffer();
    } catch (error) {
      throw toClientError(error);
    }

    return this.profileImages.upload(userId, buffer);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.USER_SETTINGS_WRITE] })
  @ApiOperation({
    summary: 'Remove the uploaded profile picture',
    description:
      'Deletes the uploaded picture (if any) and clears `profile.imageObjectId`. If the uploaded ' +
      'picture was selected, `profile.imageSource` falls back to `"provider"`. Idempotent.',
  })
  @ApiDataResponse(ProfileImageResponseDto, {
    description: 'Picture removed',
  })
  async remove(@CurrentUser('id') userId: string) {
    return this.profileImages.remove(userId);
  }
}
