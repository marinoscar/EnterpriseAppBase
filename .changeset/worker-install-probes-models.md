---
'@marinoscar/platform-cli': minor
---

Worker install steps, module and service capability probes, and model artifacts (RETRO-G2.4).

`registerInstallStep` adds app steps to `node install-deps` after the built-in ones (ordered by `order` or `after`; `--only <ids>` selects steps; `--dry-run` still changes nothing), with the helpers `ensureAptPackages`, `runWithSudoAnnounced` and `ensureDockerContainer`. `registerCapabilityProbe`, `moduleCapability` (`require.resolve`, never an import) and `httpServiceCapability` declare `module:<name>` and `service:<id>` capabilities that `registerJobRequirement` accepts; a probe is available, installed but not operational, or missing, a required one that is not available blocks startup, and the results appear in the self-test, `node doctor` and the heartbeat summary (presence probes refresh on each heartbeat). `registerModelArtifact` declares a model file (sha256, size, static or resolved URL, `targetSubdir`, `requiredBy`): `node models pull|status`, a `models` install step, download with resume and an atomic rename, and a job type whose model is missing or corrupt is not advertised. New worker variable `<PREFIX>MODELS_DIR`.

Breaking within 0.x: `probeCapabilities`, `runStartupSelfTest` and `runInstallDeps` now return promises (await them), and `InstallStep.supported`, `detect` and `install` may be asynchronous. A node with nothing registered behaves as before.
