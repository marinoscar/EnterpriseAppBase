// The ids of the sources the platform registers, shared by the built-in
// writers' `attachTo` (kept apart from the source files so a writer does not
// import a source, nor a source a writer).

import { ORG_DATA_EXPORT_SOURCE_ID } from '../sources/org-data.source';
import { USER_DATA_EXPORT_SOURCE_ID } from '../sources/user-data.source';

/**
 * The platform sources, `user-data` and `org-data`: where the built-in writers
 * (json, csv, xlsx) attach.
 *
 * @stability experimental
 */
export const PLATFORM_SOURCE_IDS: readonly string[] = Object.freeze([USER_DATA_EXPORT_SOURCE_ID, ORG_DATA_EXPORT_SOURCE_ID]);
