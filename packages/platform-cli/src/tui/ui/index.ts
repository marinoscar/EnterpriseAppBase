// `@marinoscar/platform-cli/tui/ui`: the ink component kit (RETRO-G1.4, #1068).
// Importing this subpath loads ink; `@marinoscar/platform-cli/tui` stays ink-free.
//
// The kit lives in the engine slice (the built-in `node` screen uses it, and the
// engine cannot import `tui`). It cannot be exported from the engine's index.ts
// either: `/tui` re-exports that file and must never put ink on its import
// graph. So this one file reaches into the engine's `tui/ui` barrel directly.
// eslint-disable-next-line boundaries/dependencies
export * from '../../engine/tui/ui/index.js';
