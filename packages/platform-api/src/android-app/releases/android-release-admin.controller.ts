import { BadRequestException, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ANDROID_RELEASE_REASONS,
  APK_FILE_FIELD,
  MAX_APK_BYTES,
  MAX_RELEASE_NOTES_LENGTH,
  MAX_VERSION_CODE,
  MAX_VERSION_NAME_LENGTH,
  type AdminRelease,
} from '@marinoscar/platform-contract/android-app';

import { ApiDataResponse, ErrorDto } from '../../core/index';
import { Auth, CurrentUser } from '../../identity/index';
import { SETTINGS_PERMISSIONS } from '../../settings/index';
import { AdminReleaseDto } from '../dto/android-app.dto';
import { AndroidReleaseService, type ReleaseUploadPart } from './android-release.service';

const MAX_MB = MAX_APK_BYTES / (1024 * 1024);
const RELEASE_ID_PARAM = { name: 'id', type: String, format: 'uuid', description: 'The release id.' } as const;
const NO_READ = { status: 403, description: 'Missing system_settings:read', type: ErrorDto } as const;
const NO_WRITE = { status: 403, description: 'Missing system_settings:write', type: ErrorDto } as const;
const NOT_FOUND = { status: 404, description: '`RELEASE_NOT_FOUND`', type: ErrorDto } as const;

/** The two `@fastify/multipart` request methods the upload calls, structurally. */
interface MultipartPartsRequest {
  isMultipart?(): boolean;
  parts(options: { limits: { fileSize: number; files: number; fields: number; fieldSize: number } }): AsyncIterable<ReleaseUploadPart>;
}

// =============================================================================
//   POST   /api/admin/android-app/releases                   system_settings:write
//   GET    /api/admin/android-app/releases                   system_settings:read
//   POST   /api/admin/android-app/releases/:id/make-current  system_settings:write
//   DELETE /api/admin/android-app/releases/:id               system_settings:write
// =============================================================================

/**
 * The APK releases (admin).
 *
 * @stability experimental
 */
@ApiTags('Android App')
@Controller('admin/android-app/releases')
export class AndroidReleaseAdminController {
  constructor(private readonly releases: AndroidReleaseService) {}

  /**
   * Uploads a release (multipart).
   *
   * @param req - the multipart request.
   * @param userId - the uploader.
   * @returns the stored release.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_WRITE.id] })
  @ApiOperation({
    summary: 'Upload an Android APK release (Admin)',
    description:
      `Multipart upload: the APK in the \`${APK_FILE_FIELD}\` file field plus text fields \`packageName\`, \`versionName\`, ` +
      '`versionCode`, `signingSha256` and optional `notes`, `makeCurrent` (default `true`), `force` (default `false`) and ' +
      '`trust` (default `false`). Send the text fields before the file to be refused before any byte is stored. The ' +
      `file streams to object storage (never buffered), must start with the ZIP signature and be at most ${MAX_MB} MB; ` +
      `its SHA-256 and size are computed while it streams. \`versionCode\` is 1..${MAX_VERSION_CODE}, \`versionName\` ` +
      `at most ${MAX_VERSION_NAME_LENGTH} characters of \`[0-9A-Za-z._+-]\`, \`notes\` at most ${MAX_RELEASE_NOTES_LENGTH}.\n\n` +
      'A (packageName, signingSha256) pair the trusted list does not hold is refused (`RELEASE_UNTRUSTED_APP`, 409) ' +
      'unless the list is empty (the first release bootstraps it) or `trust=true`. Made current (or with `trust=true`), ' +
      "the release's pair is added to the trusted apps when absent.\n\n" +
      'Refusals (`details.reason`): `RELEASE_NOT_AN_APK`, `RELEASE_INVALID_UPLOAD` (400); `RELEASE_TOO_LARGE` (413); ' +
      '`RELEASE_VERSION_EXISTS`, `RELEASE_VERSION_NOT_NEWER` (send `force=true` to override), `RELEASE_UNTRUSTED_APP`, ' +
      '`RELEASE_CURRENT_CONFLICT` (409); `STORAGE_NOT_CONFIGURED` (503). Audited (`android_app.release.uploaded`); ' +
      '`sizeBytes` is a decimal string.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [APK_FILE_FIELD, 'packageName', 'versionName', 'versionCode', 'signingSha256'],
      properties: {
        packageName: { type: 'string', example: 'com.example.app' },
        versionName: { type: 'string', example: '1.0.0' },
        versionCode: { type: 'integer', example: 1 },
        signingSha256: { type: 'string', description: 'AA:BB:... (32 bytes) or 64 hex digits' },
        notes: { type: 'string' },
        makeCurrent: { type: 'boolean', default: true },
        force: { type: 'boolean', default: false },
        trust: { type: 'boolean', default: false },
        [APK_FILE_FIELD]: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiDataResponse(AdminReleaseDto, { status: 201, description: 'The stored release' })
  @ApiResponse({ status: 400, description: '`RELEASE_NOT_AN_APK`, `RELEASE_INVALID_UPLOAD`', type: ErrorDto })
  @ApiResponse(NO_WRITE)
  @ApiResponse({
    status: 409,
    description: '`RELEASE_VERSION_EXISTS`, `RELEASE_VERSION_NOT_NEWER`, `RELEASE_UNTRUSTED_APP`, `RELEASE_CURRENT_CONFLICT`',
    type: ErrorDto,
  })
  @ApiResponse({ status: 413, description: `\`RELEASE_TOO_LARGE\` (over ${MAX_MB} MB)`, type: ErrorDto })
  @ApiResponse({ status: 503, description: '`STORAGE_NOT_CONFIGURED`', type: ErrorDto })
  async upload(@Req() req: unknown, @CurrentUser('id') userId: string): Promise<AdminRelease> {
    const multipart = req as MultipartPartsRequest;
    if (typeof multipart.parts !== 'function' || (multipart.isMultipart && !multipart.isMultipart())) {
      throw new BadRequestException({
        message: `Expected multipart/form-data with the APK in the "${APK_FILE_FIELD}" field.`,
        details: { reason: ANDROID_RELEASE_REASONS.INVALID_UPLOAD },
      });
    }
    const target = await this.releases.resolveUploadTarget();
    const parts = multipart.parts({ limits: { fileSize: MAX_APK_BYTES, files: 1, fields: 16, fieldSize: 16 * 1024 } });
    return this.releases.upload(parts, userId, target);
  }

  /**
   * Lists every release.
   *
   * @returns newest first.
   */
  @Get()
  @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_READ.id] })
  @ApiOperation({
    summary: 'List Android APK releases (Admin)',
    description: 'Every uploaded release, newest first; `isCurrent` marks the one users are offered.',
  })
  @ApiDataResponse(AdminReleaseDto, { isArray: true, description: 'The releases' })
  @ApiResponse(NO_READ)
  list(): Promise<AdminRelease[]> {
    return this.releases.list();
  }

  /**
   * Makes a release current.
   *
   * @param id - the release.
   * @param userId - the actor.
   * @returns the release, now current.
   */
  @Post(':id/make-current')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_WRITE.id] })
  @ApiOperation({
    summary: 'Make an Android release current (Admin)',
    description:
      'Offers this release to users and devices; the previous current release stops being current in the same ' +
      'transaction. Any release may be made current, a lower versionCode included (a rollback: devices already on a ' +
      'newer build cannot install it). Adds its signing key to the trusted apps when absent. Idempotent. ' +
      '`RELEASE_CURRENT_CONFLICT` (409) when a concurrent make-current won (the one-current index arbitrates). ' +
      'Audited (`android_app.release.made_current`).',
  })
  @ApiParam(RELEASE_ID_PARAM)
  @ApiDataResponse(AdminReleaseDto, { description: 'The release, now current' })
  @ApiResponse(NO_WRITE)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 409, description: '`RELEASE_CURRENT_CONFLICT`', type: ErrorDto })
  makeCurrent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string): Promise<AdminRelease> {
    return this.releases.makeCurrent(id, userId);
  }

  /**
   * Deletes a release (object, then row).
   *
   * @param id - the release.
   * @param userId - the actor.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_WRITE.id] })
  @ApiOperation({
    summary: 'Delete an Android release (Admin)',
    description:
      'Deletes the stored APK, then the release. The current release cannot be deleted (`RELEASE_IS_CURRENT`, 409). ' +
      '503 when object storage is not configured (nothing is deleted). Audited (`android_app.release.deleted`).',
  })
  @ApiParam(RELEASE_ID_PARAM)
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse(NO_WRITE)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 409, description: '`RELEASE_IS_CURRENT`', type: ErrorDto })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.releases.remove(id, userId);
  }
}
