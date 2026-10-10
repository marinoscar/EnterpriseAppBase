// `@marinoscar/platform-api/core/testing`: kits for the core primitives
// (PP-14.5, issue #923). Never import it from production code. Documented in
// ../README.md ("Pluggable kinds").

export { SECRET_LIKE_FIELD_PATTERN, describePluggableKindConformance } from './pluggable-conformance';
export type { PluggableConformanceHarness, PluggableConformanceOptions } from './pluggable-conformance';
