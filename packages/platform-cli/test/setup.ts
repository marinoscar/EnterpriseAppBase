import { setCliIdentity } from '../src/engine/identity.js';
import { TEST_CLI_IDENTITY } from '../src/engine/test-support.js';

// =============================================================================
// Test identity  (#715)
// =============================================================================
//
// The CLI reads its identity at call time, and most tests call a module
// directly rather than through `createCli`, so every test file starts with
// TEST_CLI_IDENTITY set (the reference app's executable name, `appctl`), as
// `apps/cli` sets its own in the real CLI. Tests that need another identity
// replace it with `useTestCliIdentity` (`/testing`).
// =============================================================================

setCliIdentity(TEST_CLI_IDENTITY, '1.0.0');
