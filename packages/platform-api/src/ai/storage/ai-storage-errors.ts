// =============================================================================
// Storage failures as AI run outcomes (issue #437, epic #420)
// =============================================================================
//
// Over HTTP a storage failure answers as itself: `StorageNotConfiguredError`
// is already a 503 with a remedy, and the input resolver's 404/403 are the
// same answers `ObjectsService` gives. A BACKGROUND RUN has no HTTP response
// to carry them — its outcome is `ai_runs.errorCode`, which is always an
// `AiErrorCode` — so a job that meets one records it through this mapping:
//
//   StorageNotConfiguredError (503)       -> AI_STORAGE_UNAVAILABLE
//   input 404 / 403 (deleted, or no
//   longer the user's to read)            -> AI_INVALID_REQUEST
//
// Anything else is not a storage outcome this file knows, and is `null`.
// =============================================================================

import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { HttpException } from '@nestjs/common';

import { AiError } from '../core/ai-error';
import type { AiObjectStore } from '../ports';

type StorageFailureClassifier = Pick<AiObjectStore, 'notConfiguredReason' | 'settingsPath'>;

/**
 * The classifier used until the app's `AI_OBJECT_STORE` is bound (and by unit
 * tests that build a handler by hand): the shape every "storage not
 * configured" error of the platform has, a 503 whose body carries
 * `details.reason` and `details.remedy`.
 */
const SHAPE_CLASSIFIER: StorageFailureClassifier = {
  settingsPath: '/admin/settings/storage',
  notConfiguredReason(err: unknown): string | null {
    if (err instanceof AiError || !(err instanceof HttpException) || err.getStatus() !== 503) return null;
    const body = err.getResponse() as { details?: { reason?: unknown; remedy?: unknown } } | string;
    if (typeof body !== 'object' || typeof body.details?.reason !== 'string' || typeof body.details.remedy !== 'string') {
      return null;
    }
    return body.details.reason;
  },
};

let classifier: StorageFailureClassifier = SHAPE_CLASSIFIER;

/**
 * Binds the object store's own recogniser of its "not configured" error.
 * Called once by `AiStorageModule` with the app's `AI_OBJECT_STORE`.
 */
export function useStorageFailureClassifier(store: StorageFailureClassifier): void {
  classifier = store;
}

/** The `AiError` a job records for a storage failure, or `null` when `err` is not one. */
export function aiErrorFromStorage(err: unknown): AiError | null {
  const reason = classifier.notConfiguredReason(err);
  if (reason !== null) {
    return new AiError(
      'AI_STORAGE_UNAVAILABLE',
      `Object storage is not configured for this deployment; an administrator must complete it at ${classifier.settingsPath}.`,
      { cause: err, details: { storageReason: reason } },
    );
  }

  if (err instanceof NotFoundException || err instanceof ForbiddenException) {
    return new AiError('AI_INVALID_REQUEST', 'An input storage object is missing or no longer accessible.', {
      cause: err,
      details: { status: err.getStatus() },
    });
  }

  return null;
}
