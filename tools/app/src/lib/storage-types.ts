/**
 * Storage API type definitions
 */

export type StorageObjectStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed';

export interface StorageObject {
  id: string;
  name: string;
  size: string; // BigInt as string
  mimeType: string;
  status: StorageObjectStatus;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorageObjectListMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface StorageObjectListResponse {
  data: {
    items: StorageObject[];
    meta: StorageObjectListMeta;
  };
}

export interface StorageObjectResponse {
  data: StorageObject;
}

export interface DownloadUrlResponse {
  data: {
    url: string;
    expiresIn: number;
  };
}

export interface UploadStatusResponse {
  data: {
    objectId: string;
    status: StorageObjectStatus;
    uploadedParts: number[];
    totalParts: number;
    uploadedBytes: string;
    totalBytes: string;
  };
}
