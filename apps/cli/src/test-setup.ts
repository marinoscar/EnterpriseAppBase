import { CLI_IDENTITY } from './branding.js';
import { setCliIdentity } from './identity.js';
import { CLI_VERSION } from './package-info.js';

// Every test runs with the reference app's identity set, as `buildProgram()`
// sets it in the real CLI: a module that reads `cliName()` outside a command
// (most tests call a function directly) must find one.
setCliIdentity(CLI_IDENTITY, CLI_VERSION);
