// `@marinoscar/platform-api/nodes/testing`: the nodes slice's test seam, the
// `nodes` conformance suite (issue #1076). Importing this entry registers the
// suite with `runPlatformConformance` (@marinoscar/platform-api/testing). Never
// import it from production code. Documented in ../README.md.

export {
  checkNodeAppRoutes,
  checkNodeRouteOwnership,
  discoverNodeAppRoutes,
  nodesConformanceSuite,
} from './conformance';
export type { NodeAppRoute, NodesConformanceOptions } from './conformance';
