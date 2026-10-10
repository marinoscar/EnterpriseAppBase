// `@marinoscar/platform-web/settings/testing`: the settings slice's conformance
// suites (issue #742). Importing this entry registers them with
// `runPlatformWebConformance`: the shared visibility and title gate, the card
// shape, the AI cards, the card-to-route parity and the route ownership. Never
// import it from production code. Documented in ../README.md.

export { settingsRegistryGatesSuite } from './settings-registry-gates.suite.js';
export { settingsRegistryShapeSuite } from './settings-registry-shape.suite.js';
export { settingsAiCardsSuite } from './settings-ai-cards.suite.js';
export { settingsCardRoutesSuite } from './settings-card-routes.suite.js';
export { settingsRouteOwnershipSuite } from './settings-route-ownership.suite.js';
export { parseAppRoutes, resolveAppRoutes } from './routes.js';
