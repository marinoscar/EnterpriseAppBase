import { greeterKind, plainGreeter, signedGreeter } from '../platform-extensions/core/greeter.kind';

// =============================================================================
// This app's pluggable-kind registrations (PP-14.5, issue #923)
// =============================================================================
//
// A pluggable kind (`definePluggableKind` of `@marinoscar/platform-api/core`) is
// a registry of implementations. Register an app's own implementations here,
// AT IMPORT TIME: the kind freezes once the application has bootstrapped.
// Unlike the pure-data files of this folder, this one makes the `register` calls
// itself, like `host.ts`; whatever builds a kind's instances must import it
// before the container is created.
//
// The reference app registers the worked example, the toy `greeter` kind
// (`platform-extensions/core/greeter.kind.ts`). No platform slice consumes it, so
// nothing in the running app imports this file; the example spec does
// (`test/examples/core/pluggable-kind.spec.ts`). A fork deletes the lines below
// and registers implementations of the kinds its slices expose.
// =============================================================================

greeterKind.register(plainGreeter);
greeterKind.register(signedGreeter);
