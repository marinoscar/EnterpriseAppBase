import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Req,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from 'nestjs-zod';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ObjectsService } from './objects.service';
import {
  InitUploadDto,
  InitUploadResponseDto,
  initUploadSchema,
} from './dto/init-upload.dto';
import {
  CompleteUploadDto,
  completeUploadSchema,
} from './dto/complete-upload.dto';
import {
  ObjectResponseDto,
  UploadStatusResponseDto,
} from './dto/object-response.dto';

@ApiTags('Storage')
@Controller('storage/objects')
@Auth()
export class ObjectsController {
  constructor(private readonly objectsService: ObjectsService) {}

  /**
   * Initialize resumable multipart upload
   */
  @Post('upload/init')
  @ApiOperation({
    summary: 'Initialize resumable upload',
    description: 'Start a multipart upload for large files',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload initialized successfully',
    type: Object,
  })
  async initUpload(
    @Body(new ZodValidationPipe(initUploadSchema)) dto: InitUploadDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: InitUploadResponseDto }> {
    const result = await this.objectsService.initUpload(dto, userId);
    return { data: result };
  }

  /**
   * Get upload status and progress
   */
  @Get(':id/upload/status')
  @ApiOperation({
    summary: 'Get upload status',
    description: 'Check progress of a resumable upload',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload status retrieved',
    type: Object,
  })
  async getUploadStatus(
    @Param('id') objectId: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: UploadStatusResponseDto }> {
    const result = await this.objectsService.getUploadStatus(objectId, userId);
    return { data: result };
  }

  /**
   * Complete multipart upload
   */
  @Post(':id/upload/complete')
  @ApiOperation({
    summary: 'Complete resumable upload',
    description: 'Finalize a multipart upload after all parts are uploaded',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed successfully',
    type: Object,
  })
  async completeUpload(
    @Param('id') objectId: string,
    @Body(new ZodValidationPipe(completeUploadSchema)) dto: CompleteUploadDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: ObjectResponseDto }> {
    const result = await this.objectsService.completeUpload(
      objectId,
      dto,
      userId,
    );
    return { data: result };
  }

  /**
   * Abort multipart upload
   */
  @Delete(':id/upload/abort')
  @ApiOperation({
    summary: 'Abort resumable upload',
    description: 'Cancel an in-progress multipart upload',
  })
  @ApiResponse({
    status: 204,
    description: 'Upload aborted successfully',
  })
  async abortUpload(
    @Param('id') objectId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.objectsService.abortUpload(objectId, userId);
  }

  /**
   * Simple upload for smaller files (< 100MB)
   */
  @Post()
  @ApiOperation({
    summary: 'Simple file upload',
    description: 'Direct upload for files under 100MB',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'File to upload',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'File uploaded successfully',
    type: Object,
  })
  async simpleUpload(
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: ObjectResponseDto }> {
    // Get multipart file from request
    const data = await req.file();

    if (!data) {
      throw new BadRequestException('No file provided');
    }

    const result = await this.objectsService.simpleUpload(
      {
        filename: data.filename,
        mimetype: data.mimetype,
        file: data.file,
      },
      userId,
    );

    return { data: result };
  }
}
