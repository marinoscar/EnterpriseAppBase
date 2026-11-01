// The storage objects client (issue #736, PP-8.3): the `/api/storage/objects`
// routes and `GET /api/storage/status`, over the app's transport. Moved from
// the reference app's `services/storage.ts` (behaviour unchanged) and widened
// to the resumable upload (init, part status, complete, abort): file bytes
// never pass through the API there, the parts go straight to the presigned
// URLs the init call returns.

import type {
  CompleteUploadDto,
  DownloadUrlResponse,
  InitUploadDto,
  InitUploadResponse,
  ObjectResponse,
  StorageObjectStatusName,
  StorageStatusResponse,
  UploadStatusResponse,
} from '@marinoscar/platform-contract/storage';

import type { PlatformApiClient } from '../../core/index.js';

/**
 * A storage object as the API returns it (`ObjectResponse` of the contract).
 *
 * @stability experimental
 */
export type StorageObject = ObjectResponse;

/**
 * A storage object's upload status.
 *
 * @stability experimental
 */
export type StorageObjectStatus = StorageObjectStatusName;

/**
 * A signed download URL and its lifetime in seconds.
 *
 * @stability experimental
 */
export type StorageDownloadUrl = DownloadUrlResponse;

/**
 * The transport the client needs: the platform host's `PlatformApiClient`,
 * plus a multipart POST for the simple upload. Without `postFormData` the
 * client still serves every other call; `upload` then rejects.
 *
 * @stability experimental
 */
export type StorageObjectsTransport = Pick<PlatformApiClient, 'get' | 'post' | 'delete'> & {
  /** `POST path` with a `multipart/form-data` body; resolves to the response's `data`. */
  postFormData?<T>(path: string, body: FormData): Promise<T>;
};

/**
 * The polling bounds of {@link StorageObjectsClient.waitForReady}.
 *
 * @stability experimental
 */
export interface WaitForReadyOptions {
  /** Delay between polls, in milliseconds. Default 500. */
  intervalMs?: number;
  /** Give up after this many milliseconds. Default 30 000. */
  timeoutMs?: number;
}

/**
 * An uploaded object did not become `ready`: processing failed, or it is
 * still processing after the wait's timeout.
 *
 * @stability experimental
 */
export class StorageObjectNotReadyError extends Error {
  /**
   * @param objectId - the object.
   * @param status - `failed`, or `timeout` when the wait gave up.
   */
  constructor(
    /** The object. */
    readonly objectId: string,
    /** Why: `failed`, or `timeout`. */
    readonly status: StorageObjectStatus | 'timeout',
  ) {
    super(
      status === 'timeout'
        ? 'The uploaded file is still being processed. Try again in a moment.'
        : 'The uploaded file could not be processed.',
    );
    this.name = 'StorageObjectNotReadyError';
  }
}

/**
 * The calls of the storage objects API.
 *
 * @stability experimental
 */
export interface StorageObjectsClient {
  /** `GET /storage/status`: whether object storage is configured (`storage:read`). */
  status(): Promise<StorageStatusResponse>;
  /** `POST /storage/objects` (multipart): the simple upload, up to the deployment's simple-upload limit. */
  upload(file: Blob, filename?: string): Promise<StorageObject>;
  /** `POST /storage/objects/upload/init`: opens a resumable upload; returns presigned part URLs. */
  initUpload(input: InitUploadDto): Promise<InitUploadResponse>;
  /** `GET /storage/objects/:id/upload/status`: the parts uploaded so far, for a resume. */
  uploadStatus(id: string): Promise<UploadStatusResponse>;
  /** `POST /storage/objects/:id/upload/complete`: completes it from the parts' ETags. */
  completeUpload(id: string, input: CompleteUploadDto): Promise<StorageObject>;
  /** `DELETE /storage/objects/:id/upload/abort`: abandons it. */
  abortUpload(id: string): Promise<void>;
  /** `GET /storage/objects/:id`. */
  get(id: string): Promise<StorageObject>;
  /** `GET /storage/objects/:id/download`: a time-limited signed URL to fetch directly. */
  downloadUrl(id: string): Promise<StorageDownloadUrl>;
  /** `DELETE /storage/objects/:id`. */
  remove(id: string): Promise<void>;
  /** Polls until `object` is `ready`; rejects with {@link StorageObjectNotReadyError} on `failed` or timeout. */
  waitForReady(object: StorageObject, options?: WaitForReadyOptions): Promise<StorageObject>;
  /** {@link StorageObjectsClient.upload}, then {@link StorageObjectsClient.waitForReady}. */
  uploadAndWait(file: Blob, options?: WaitForReadyOptions & { filename?: string }): Promise<StorageObject>;
}

const OBJECTS = '/storage/objects';

/**
 * Builds the storage objects client over a transport.
 *
 * @param api - the app's transport (the platform host's `api`, or the app's own client).
 * @returns the client.
 *
 * @example
 * ```ts
 * const storage = createStorageObjectsClient(api);
 * const object = await storage.uploadAndWait(file);
 * const { url } = await storage.downloadUrl(object.id);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function createStorageObjectsClient(api: StorageObjectsTransport): StorageObjectsClient {
  const id = (value: string) => encodeURIComponent(value);

  const client: StorageObjectsClient = {
    status: () => api.get<StorageStatusResponse>('/storage/status'),
    upload: async (file, filename) => {
      if (typeof api.postFormData !== 'function') {
        throw new Error('This transport cannot send multipart/form-data: pass a client with postFormData.');
      }
      const formData = new FormData();
      if (filename === undefined) formData.append('file', file);
      else formData.append('file', file, filename);
      return api.postFormData<StorageObject>(OBJECTS, formData);
    },
    initUpload: (input) => api.post<InitUploadResponse>(`${OBJECTS}/upload/init`, input),
    uploadStatus: (objectId) => api.get<UploadStatusResponse>(`${OBJECTS}/${id(objectId)}/upload/status`),
    completeUpload: (objectId, input) => api.post<StorageObject>(`${OBJECTS}/${id(objectId)}/upload/complete`, input),
    abortUpload: async (objectId) => {
      await api.delete<unknown>(`${OBJECTS}/${id(objectId)}/upload/abort`);
    },
    get: (objectId) => api.get<StorageObject>(`${OBJECTS}/${id(objectId)}`),
    downloadUrl: (objectId) => api.get<StorageDownloadUrl>(`${OBJECTS}/${id(objectId)}/download`),
    remove: async (objectId) => {
      await api.delete<unknown>(`${OBJECTS}/${id(objectId)}`);
    },
    waitForReady: async (object, { intervalMs = 500, timeoutMs = 30_000 } = {}) => {
      const deadline = Date.now() + timeoutMs;
      let current = object;
      while (current.status !== 'ready') {
        if (current.status === 'failed') throw new StorageObjectNotReadyError(current.id, 'failed');
        if (Date.now() >= deadline) throw new StorageObjectNotReadyError(current.id, 'timeout');
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        current = await client.get(current.id);
      }
      return current;
    },
    uploadAndWait: async (file, options = {}) => client.waitForReady(await client.upload(file, options.filename), options),
  };
  return client;
}
