/**
 * The caller's own storage objects (`/api/storage/objects`) — issue #445.
 *
 * The slice of the storage API the AI Playground needs: upload a file the AI
 * call will read by `storageObjectId` (an image to edit, and — in later
 * stories — audio to transcribe or a file to attach), wait for it to become
 * usable, and get a short-lived signed URL to show or download an object the
 * AI created (a generated image).
 *
 * ⚠ AN UPLOAD IS NOT USABLE AT ONCE. `POST /storage/objects` answers with the
 * object in `processing`; post-processing moves it to `ready` (or `failed`)
 * moments later, and the AI routes refuse an input that is not `ready`
 * (`AI_INVALID_REQUEST`). {@link uploadStorageObjectAndWait} is the one call a
 * feature should make.
 *
 * ⚠ A SIGNED URL IS A BEARER CREDENTIAL for its lifetime: it is fetched when
 * needed, kept in memory only, and never logged or stored.
 *
 * Since #736 the calls are the storage slice's objects client
 * (`createStorageObjectsClient` of `@marinoscar/platform-web/storage/headless`),
 * bound here to the app's transport; this module keeps its function names so
 * the AI components and their tests are unchanged.
 */
import {
  StorageObjectNotReadyError,
  createStorageObjectsClient,
  type StorageDownloadUrl,
  type StorageObject,
  type StorageObjectStatus,
  type WaitForReadyOptions,
} from '@marinoscar/platform-web/storage/headless';

import { api } from './api';
import type { StorageStatus } from '../types';

export { StorageObjectNotReadyError };
export type { StorageDownloadUrl, StorageObject, StorageObjectStatus, WaitForReadyOptions };

const objects = () => createStorageObjectsClient(api);

/** `GET /storage/status`: whether the deployment has object storage at all. */
export async function getStorageStatus(): Promise<StorageStatus> {
  return objects().status();
}

/** Upload one file (`POST /storage/objects`, multipart). Resolves with the object, usually still `processing`. */
export async function uploadStorageObject(file: File): Promise<StorageObject> {
  return objects().upload(file);
}

/** One of the caller's own objects. */
export async function getStorageObject(id: string): Promise<StorageObject> {
  return objects().get(id);
}

/** A short-lived signed URL for one of the caller's own objects. */
export async function getStorageObjectDownloadUrl(id: string): Promise<StorageDownloadUrl> {
  return objects().downloadUrl(id);
}

/**
 * Polls until `object` is `ready`; rejects with {@link StorageObjectNotReadyError}
 * on `failed` or after `timeoutMs`.
 */
export async function waitForStorageObjectReady(
  object: StorageObject,
  options: WaitForReadyOptions = {},
): Promise<StorageObject> {
  return objects().waitForReady(object, options);
}

/** {@link uploadStorageObject}, then {@link waitForStorageObjectReady}: the one call a feature should make. */
export async function uploadStorageObjectAndWait(
  file: File,
  options?: WaitForReadyOptions,
): Promise<StorageObject> {
  return objects().uploadAndWait(file, options);
}
