// =============================================================================
// Docker's answer for a list of containers, in the shape the engine asks for
// =============================================================================
//
// `listComposeContainers` (../compose-containers.ts) runs one `docker ps -aq`
// and ONE `docker inspect --format <INSPECT_FORMAT>`; a fake Docker answers the
// first with ids and the second with one line per container:
// `/name|running|ports,|project|workingDir`. Tests describe containers as data
// and let this render the lines, so the wire format lives in one place.
// =============================================================================

/** A container as a test describes it. */
export interface FakeContainer {
  /** Defaults to `<project>-svc-<index>`. */
  name?: string;
  /** The `com.docker.compose.project` label; `''` for a container that is not compose's. */
  project: string;
  /** The `com.docker.compose.project.working_dir` label. */
  workingDir: string;
  /** Defaults to true. */
  running?: boolean;
  /** Host ports it is configured to publish (a stopped container publishes them too). */
  ports?: ReadonlyArray<number | string>;
}

/** The `docker ps -aq` output for `containers`. */
export function psOutput(containers: readonly FakeContainer[]): string {
  return containers.map((_, index) => `id${index}`).join('\n');
}

/** The `docker inspect --format <INSPECT_FORMAT>` output for `containers`. */
export function inspectOutput(containers: readonly FakeContainer[]): string {
  return containers
    .map((container, index) => {
      const name = container.name ?? `${container.project === '' ? 'plain' : container.project}-svc-${index}`;
      const ports = (container.ports ?? []).map((port) => `${port},`).join('');
      return `/${name}|${container.running === false ? 'false' : 'true'}|${ports}|${container.project}|${container.workingDir}`;
    })
    .join('\n');
}
