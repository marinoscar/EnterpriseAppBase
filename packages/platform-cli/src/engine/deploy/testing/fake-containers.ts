// =============================================================================
// Docker's answer for a list of containers, in the shape the engine asks for
// =============================================================================
//
// `listComposeContainers` (../compose-containers.ts) runs one `docker ps -aq`
// and ONE `docker inspect --format <INSPECT_FORMAT>`; a fake Docker answers the
// first with ids and the second with one line per container:
// `/name|running|{"80/tcp":[{"HostIp":"","HostPort":"3535"}]}|project|workingDir`. Tests describe containers as data
// and let this render the lines, so the wire format lives in one place.
// =============================================================================

/** A host port binding with its address and protocol, for a test about WHERE a port is published. */
export interface FakeBinding {
  /** Defaults to every interface (`''`). */
  hostIp?: string;
  port: number | string;
  /** Defaults to `tcp`. */
  protocol?: string;
}

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
  /**
   * Host ports it is configured to publish (a stopped container publishes them
   * too): a bare port, or a binding naming the address and protocol.
   */
  ports?: ReadonlyArray<number | string | FakeBinding>;
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
      // The JSON of HostConfig.PortBindings, as `docker inspect` prints it.
      const bindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {};
      for (const port of container.ports ?? []) {
        const binding = typeof port === 'object' ? port : { port };
        const key = `80/${binding.protocol ?? 'tcp'}`;
        (bindings[key] ??= []).push({ HostIp: ('hostIp' in binding ? binding.hostIp : undefined) ?? '', HostPort: String(binding.port) });
      }
      const ports = Object.keys(bindings).length === 0 ? 'null' : JSON.stringify(bindings);
      return `/${name}|${container.running === false ? 'false' : 'true'}|${ports}|${container.project}|${container.workingDir}`;
    })
    .join('\n');
}
