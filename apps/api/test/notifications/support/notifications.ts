// The notifications slice as this app's tests see it (issue #738): the
// package's public surface, its test seams (the internals a unit test
// constructs: channels, the delivery log, the stream, the broadcast handlers),
// and the app's own import-time snapshots of the registries. The specs moved
// from apps/api/src/notifications with the code import from here instead of
// from the old relative paths; nothing else about them changed.

export * from '@marinoscar/platform-api/notifications';
export * from '@marinoscar/platform-api/notifications/testing';
export * from '../../../src/platform/notifications';

// The wire shapes a few moved specs name, from the slice's contract (not
// re-exported wholesale: the API slice's registry patterns share names with
// the contract's syntactic bounds).
export { DEFAULT_VAPID_SUBJECT, pushTestResponseSchema } from '@marinoscar/platform-contract/notifications';
export type { CreateBroadcastInput, PushSubscribeRequest } from '@marinoscar/platform-contract/notifications';
