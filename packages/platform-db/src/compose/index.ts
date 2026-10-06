// The schema composer: `platform db compose` and its programmatic API.
export { ComposeError, type ComposeErrorCode } from './errors.js';
export {
  checkComposedSchema,
  composeSchema,
  writeComposedSchema,
  type ComposeCheck,
  type ComposeOptions,
  type ComposeResult,
} from './api.js';
